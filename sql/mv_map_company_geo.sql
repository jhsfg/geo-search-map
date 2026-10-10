

DROP MATERIALIZED VIEW IF EXISTS mv_map_company_geo;

CREATE MATERIALIZED VIEW mv_map_company_geo AS
WITH comp AS (
    SELECT
        yc.cid,
        COALESCE(c2.id, c3.id) AS country_id,
        NULLIF(btrim(yc.state), '') AS state_raw,
        NULLIF(btrim(yc.city),  '') AS city_raw
    FROM y_company yc
    LEFT JOIN countries c2
        ON c2.iso2 = CASE WHEN yc.country = 'UK' THEN 'GB' ELSE yc.country END
    LEFT JOIN countries c3
        ON c3.iso3 = UPPER(yc.country)
    WHERE yc.t_status = 1
),
st_match AS (
    SELECT DISTINCT ON (c.cid)
        c.cid, c.country_id, s.id AS state_id, c.city_raw
    FROM comp c
    JOIN states s
        ON s.country_id = c.country_id
       AND (lower(s.name) = lower(c.state_raw) OR s.iso2 = UPPER(c.state_raw))
    WHERE c.country_id IS NOT NULL AND c.state_raw IS NOT NULL
    ORDER BY c.cid, (lower(s.name) = lower(c.state_raw)) DESC, s.id
),
city_exact AS (
    SELECT DISTINCT ON (sm.cid)
        sm.cid, sm.country_id, sm.state_id, ci.id AS city_id
    FROM st_match sm
    JOIN cities ci
        ON ci.state_id = sm.state_id
       AND lower(ci.name) = lower(sm.city_raw)
    WHERE sm.city_raw IS NOT NULL
    ORDER BY sm.cid, ci.id
),
city_norm AS (
    SELECT DISTINCT ON (sm.cid)
        sm.cid, sm.country_id, sm.state_id, ci.id AS city_id
    FROM st_match sm
    JOIN cities ci
        ON ci.state_id = sm.state_id
       AND lower(ci.name) = lower(map_normalize_city(sm.city_raw))
    WHERE sm.city_raw IS NOT NULL
      AND sm.cid NOT IN (SELECT cid FROM city_exact)
    ORDER BY sm.cid, ci.id
),
city_prefix AS (
   
    SELECT DISTINCT ON (sm.cid)
        sm.cid, sm.country_id, sm.state_id, ci.id AS city_id
    FROM st_match sm
    JOIN cities ci
        ON ci.state_id = sm.state_id
       AND lower(ci.name) LIKE lower(sm.city_raw) || ' %'
    WHERE sm.city_raw IS NOT NULL
      AND char_length(sm.city_raw) >= 3
      AND sm.cid NOT IN (SELECT cid FROM city_exact)
      AND sm.cid NOT IN (SELECT cid FROM city_norm)
    ORDER BY sm.cid, ci.id
),
city_by_state AS (
    SELECT * FROM city_exact UNION ALL
    SELECT * FROM city_norm  UNION ALL
    SELECT * FROM city_prefix
),
city_nostate_exact AS (
    SELECT DISTINCT ON (c.cid)
        c.cid, c.country_id, ci.state_id, ci.id AS city_id
    FROM comp c
    JOIN cities ci
        ON ci.country_id = c.country_id
       AND lower(ci.name) = lower(c.city_raw)
    WHERE c.country_id IS NOT NULL
      AND c.state_raw IS NULL
      AND c.city_raw IS NOT NULL
    ORDER BY c.cid, ci.id
),
city_nostate_norm AS (
    SELECT DISTINCT ON (c.cid)
        c.cid, c.country_id, ci.state_id, ci.id AS city_id
    FROM comp c
    JOIN cities ci
        ON ci.country_id = c.country_id
       AND lower(ci.name) = lower(map_normalize_city(c.city_raw))
    WHERE c.country_id IS NOT NULL
      AND c.state_raw IS NULL
      AND c.city_raw IS NOT NULL
      AND c.cid NOT IN (SELECT cid FROM city_nostate_exact)
    ORDER BY c.cid, ci.id
),
city_by_country AS (
    SELECT * FROM city_nostate_exact UNION ALL SELECT * FROM city_nostate_norm
),
comp_geo AS (
    SELECT cid, country_id, state_id, city_id FROM city_by_state
    UNION ALL
    SELECT cid, country_id, state_id, city_id FROM city_by_country
    UNION ALL
    SELECT sm.cid, sm.country_id, sm.state_id, NULL::int
    FROM st_match sm WHERE sm.cid NOT IN (SELECT cid FROM city_by_state)
    UNION ALL
    SELECT c.cid, c.country_id, NULL::int, NULL::int
    FROM comp c
    WHERE c.country_id IS NOT NULL AND c.state_raw IS NULL
      AND c.cid NOT IN (SELECT cid FROM city_by_country)
    UNION ALL
    SELECT c.cid, c.country_id, NULL::int, NULL::int
    FROM comp c
    WHERE c.country_id IS NOT NULL AND c.state_raw IS NOT NULL
      AND c.cid NOT IN (SELECT cid FROM st_match)
)
SELECT
    g.cid,
    g.country_id,
    co.iso2      AS country_iso2,
    co.name      AS country_name,
    g.state_id,
    st.name      AS state_name,
    g.city_id,
    ci.name      AS city_name,
    ci.latitude,
    ci.longitude
FROM comp_geo g
JOIN countries co ON co.id = g.country_id
LEFT JOIN states st ON st.id = g.state_id
LEFT JOIN cities ci ON ci.id = g.city_id;

CREATE UNIQUE INDEX mv_map_company_geo_cid_idx ON mv_map_company_geo (cid);

CREATE INDEX mv_map_company_geo_city_idx    ON mv_map_company_geo (city_id);
CREATE INDEX mv_map_company_geo_state_idx   ON mv_map_company_geo (state_id);
CREATE INDEX mv_map_company_geo_country_idx ON mv_map_company_geo (country_iso2);
