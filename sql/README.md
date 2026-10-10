# SQL: Materialized View for Company Geo Mapping

## Overview

The materialized view `mv_map_company_geo` maps each company record to its geographic coordinates (latitude/longitude) by matching country, state, and city fields against the `countries`, `states`, and `cities` reference tables.

This enables O(1) geographic lookup during search — no runtime fuzzy matching needed.

## Matching Pipeline

```
y_company.country → countries.iso2 (exact, UK→GB alias)
       ↓
y_company.state → states.name (ILIKE) or states.iso2 (exact)
       ↓
y_company.city → cities.name (exact → normalized → prefix match)
```

Companies without a city match fall back to state-level or country-level coordinates.

## Performance

- ~700K company records matched in ~30 seconds
- Unique index on `cid` enables `REFRESH MATERIALIZED VIEW CONCURRENTLY`
- Indexed on `city_id`, `state_id`, `country_iso2` for fast JOIN

## Refresh Schedule

Refresh weekly during low-traffic periods:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_map_company_geo;
```

## Table Schema Notes

Replace these placeholder table/column names with your actual schema:

| Placeholder in SQL | Your actual table |
|---|---|
| `y_company` | Your company/business table |
| `yc.cid` | Primary key (company ID) |
| `yc.country` | ISO2 country code (e.g. 'US', 'CN', 'GB') |
| `yc.state` | State/province name or abbreviation |
| `yc.city` | City name |
| `yc.t_status` | Status flag (1 = active) |

The `countries`, `states`, `cities` reference tables can be obtained from the [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) open dataset.

## Custom City Normalization

The SQL references a `map_normalize_city()` function for handling common abbreviations:

```sql
CREATE OR REPLACE FUNCTION map_normalize_city(input TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN lower(btrim(
        replace(replace(replace(replace(replace(replace(replace(
            input,
            'St. ', 'Saint '),
            'Ft. ', 'Fort '),
            'Mt. ', 'Mount '),
            'N. ', 'North '),
            'S. ', 'South '),
            'E. ', 'East '),
            'W. ', 'West ')
        ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```
