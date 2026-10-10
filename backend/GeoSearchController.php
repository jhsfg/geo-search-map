<?php
/**
 * Geo Search API Controller - Returns city-clustered map markers + paginated company list
 *
 * Endpoint: GET /api/map/geo-search?q={keyword}&city_id={optional}&page={optional}
 * Response: { code: 0, data: { total, cities: [...], companies: [...], page, has_more } }
 *
 * Dependencies: PostgreSQL with full-text search (plainto_tsquery) + materialized view
 * Framework: Webman (PHP) - works with any PHP framework with minor adaptations
 *
 * @license MIT
 */
class GeoSearchController
{
    /**
     * GET /api/map/geo-search
     * Query params:
     *   - q: search keyword (min 2 chars)
     *   - city_id: optional city filter (from map marker click)
     *   - page: pagination page (default 1, max 7)
     */
    public function geoSearch(Request $request)
    {
        $q = trim((string)$request->get('q', ''));
        if ($q === '' || $q === '-' || mb_strlen($q) < 2) {
            return json(['code' => 1, 'msg' => 'keyword too short']);
        }

        $cityId = (int)$request->get('city_id', 0);
        $page   = max(1, (int)$request->get('page', 1));
        $perPage = 30;
        $maxPage = 7; // Max 210 companies to prevent deep pagination
        if ($page > $maxPage) {
            $page = $maxPage;
        }
        $offset = ($page - 1) * $perPage;

        // --- Total count (PostgreSQL full-text search) ---
        $countSql = "
            SELECT COUNT(*) AS c
            FROM your_company_table yc
            JOIN mv_map_company_geo g ON g.cid = yc.id
            WHERE yc.status = 1
              AND yc.search_vector_col @@ plainto_tsquery('english', ?)
        ";
        $countParams = [$q];
        if ($cityId > 0) {
            $countSql .= ' AND g.city_id = ?';
            $countParams[] = $cityId;
        }
        $total = (int)Db::selectOne(Db::raw($countSql), $countParams)->c;

        // --- City aggregation markers ---
        $cities = [];
        if ($cityId > 0) {
            $cities = Db::select(Db::raw("
                SELECT g.city_id AS id, g.city_name AS name, g.state_name AS state,
                       g.country_iso2 AS country, g.latitude, g.longitude, COUNT(*) AS count
                FROM your_company_table yc
                JOIN mv_map_company_geo g ON g.cid = yc.id
                WHERE yc.status = 1
                  AND yc.search_vector_col @@ plainto_tsquery('english', ?)
                  AND g.city_id = ?
                GROUP BY g.city_id, g.city_name, g.state_name, g.country_iso2, g.latitude, g.longitude
            "), [$q, $cityId]);
        } else {
            $cities = Db::select(Db::raw("
                SELECT g.city_id AS id, g.city_name AS name, g.state_name AS state,
                       g.country_iso2 AS country, g.latitude, g.longitude, COUNT(*) AS count
                FROM your_company_table yc
                JOIN mv_map_company_geo g ON g.cid = yc.id
                WHERE yc.status = 1
                  AND yc.search_vector_col @@ plainto_tsquery('english', ?)
                  AND g.city_id IS NOT NULL
                GROUP BY g.city_id, g.city_name, g.state_name, g.country_iso2, g.latitude, g.longitude
                ORDER BY count DESC
                LIMIT 200
            "), [$q]);
        }

        // --- Current page company list ---
        $listSql = "
            SELECT yc.id AS cid, yc.name AS companyname, yc.logo, yc.products,
                   yc.country, yc.state, yc.city, yc.address,
                   yc.founded_year, yc.business_type,
                   yc.contact_name, yc.contact_gender, yc.contact_title,
                   yc.phone, yc.mobile, yc.fax, yc.website, yc.about,
                   g.city_id, g.city_name, g.state_name, g.latitude, g.longitude
            FROM your_company_table yc
            JOIN mv_map_company_geo g ON g.cid = yc.id
            WHERE yc.status = 1
              AND yc.search_vector_col @@ plainto_tsquery('english', ?)
        ";
        $listParams = [$q];
        if ($cityId > 0) {
            $listSql .= ' AND g.city_id = ?';
            $listParams[] = $cityId;
        }
        $listSql .= ' ORDER BY yc.id DESC LIMIT ? OFFSET ?';
        $listParams[] = $perPage;
        $listParams[] = $offset;

        $companies = Db::select(Db::raw($listSql), $listParams);

        // --- Build response data ---
        $companyData = array_map(function ($c) {
            // Mask phone numbers for privacy (e.g. 123****7890)
            $mask = function ($phone) {
                $phone = trim((string)$phone);
                $len = strlen($phone);
                if ($len <= 6) return $phone;
                return substr($phone, 0, 3) . str_repeat('*', $len - 7) . substr($phone, -4);
            };

            $contact = trim((string)$c->contact_name);
            if ($contact !== '') {
                $prefix = $c->contact_gender == 0 ? 'Ms. ' : 'Mr. ';
                $contact = $prefix . $contact;
                if (!empty($c->contact_title)) {
                    $contact .= ' (' . $c->contact_title . ')';
                }
            }

            return [
                'cid'      => (int)$c->cid,
                'name'     => $c->companyname,
                'logo'     => $c->logo,
                'products' => $c->products,
                'city'     => $c->city_name ?: $c->city,
                'state'    => $c->state_name ?: $c->state,
                'country'  => $c->country,
                'address'  => $c->address,
                'founded'  => (!empty($c->founded_year) && $c->founded_year !== '0') ? $c->founded_year : null,
                'biztype'  => $c->business_type ?: null,
                'contact'  => $contact ?: null,
                'tel'      => !empty($c->phone) ? $mask($c->phone) : null,
                'mobile'   => !empty($c->mobile) ? $mask($c->mobile) : null,
                'fax'      => !empty($c->fax) ? $mask($c->fax) : null,
                'website'  => !empty($c->website) ? $c->website : null,
                'intro'    => !empty($c->about) ? $c->about : null,
                'city_id'  => $c->city_id ? (int)$c->city_id : null,
                'lat'      => $c->latitude !== null ? (float)$c->latitude : null,
                'lng'      => $c->longitude !== null ? (float)$c->longitude : null,
                'url'      => null, // Link to your company detail page
            ];
        }, $companies);

        // --- City markers output ---
        $cityData = array_map(function ($ct) {
            return [
                'id'      => (int)$ct->id,
                'name'    => $ct->name,
                'state'   => $ct->state,
                'country' => $ct->country,
                'lat'     => (float)$ct->latitude,
                'lng'     => (float)$ct->longitude,
                'count'   => (int)$ct->count,
            ];
        }, $cities);

        return json([
            'code' => 0,
            'data' => [
                'total'     => $total,
                'cities'    => $cityData,
                'companies' => $companyData,
                'page'      => $page,
                'has_more'  => ($offset + $perPage) < $total,
            ],
        ]);
    }
}
