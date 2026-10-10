/**
 * Geo Search Map - Full-screen interactive map search (Google Maps style)
 * Requires: Leaflet 1.9+ and Leaflet.markercluster 1.5+
 * @license MIT
 */
(function () {
    'use strict';

    // Configure this to point to your geo-search API endpoint
    var API_URL = window.GEO_SEARCH_API_URL || '/api/map/geo-search';
    var MAX_LIST = 210; // 7 pages x 30 per page
    var RECENT_KEY = 'ms_recent_searches'; // localStorage key
    var RECENT_MAX = 8; // max 8 recent searches

    var state = {
        q: '',
        cityId: 0,
        cityName: '',
        page: 1,
        hasMore: false,
        loading: false,
        companies: [],
        cities: [],
        seq: 0 // 请求序号，丢弃过期响应
    };

    var map, markerLayer, currentTileLayer;
    var markerById = {}; // city_id -> leaflet marker
    var userPin = null;
    var detailPanelOpen = false;

    // ---------- 工具 ----------
    function $(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function truncate(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
    }

    // ---------- 最近搜索（localStorage 本地保存/读取） ----------
    function getRecent() {
        try {
            var list = JSON.parse(localStorage.getItem(RECENT_KEY));
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function saveRecent(q) {
        // 去重（忽略大小写），最新置顶，超出长度截断
        var list = getRecent().filter(function (k) { return k.toLowerCase() !== q.toLowerCase(); });
        list.unshift(q);
        if (list.length > RECENT_MAX) list.length = RECENT_MAX;
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
        renderRecent();
    }

    function clearRecent() {
        try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
        renderRecent();
    }

    function renderRecent() {
        var box = $('recent-chips');
        var list = getRecent();
        if (!list.length) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }
        var html = '<span class="chip chip--label">Recent</span>';
        html += list.map(function (k) {
            return '<button class="chip chip--recent" data-q="' + escapeHtml(k) + '">' + escapeHtml(truncate(k, 20)) + '</button>';
        }).join('');
        html += '<button class="chip chip--clear" id="recent-clear" title="Clear recent searches">✕</button>';
        box.innerHTML = html;
        box.style.display = 'flex';

        box.querySelectorAll('.chip--recent').forEach(function (chip) {
            chip.addEventListener('click', function () {
                $('keyword-input').value = chip.getAttribute('data-q');
                runSearch(true);
            });
        });
        $('recent-clear').addEventListener('click', clearRecent);
    }

    // ---------- 地图 ----------
    function initMap() {
        map = L.map('map', { zoomControl: false, attributionControl: false })
            .setView([25, 10], 2);

        // 三种底图
        window._tileLayers = {
            standard: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18, attribution: '&copy; OSM'
            }),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 18, attribution: '&copy; Esri'
            }),
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO'
            })
        };
        currentTileLayer = window._tileLayers.standard;
        currentTileLayer.addTo(map);

        // MarkerCluster（聚合城市）
        markerLayer = L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: function (cluster) {
                var count = cluster.getChildCount();
                var sz = count < 20 ? 36 : (count < 100 ? 44 : 52);
                return L.divIcon({
                    html: '<div>' + count + '</div>',
                    className: 'ms-cluster',
                    iconSize: L.point(sz, sz)
                });
            }
        });
        map.addLayer(markerLayer);
    }

    function switchTileLayer(name) {
        if (currentTileLayer) map.removeLayer(currentTileLayer);
        currentTileLayer = window._tileLayers[name];
        currentTileLayer.addTo(map);
    }

    function refreshMapSize() {
        setTimeout(function () { map.invalidateSize({ pan: true }); }, 320);
    }

    // 浏览器定位脉冲点
    function locateUser() {
        if (!navigator.geolocation) {
            showHint('Geolocation not supported by this browser');
            return;
        }
        navigator.geolocation.getCurrentPosition(function (pos) {
            var lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (userPin) map.removeLayer(userPin);
            userPin = L.marker([lat, lng], {
                icon: L.divIcon({ className: 'user-dot', iconSize: [16, 16] })
            }).addTo(map);
            map.flyTo([lat, lng], 10, { duration: 0.8 });
        }, function () {
            showHint('Unable to get your location');
        });
    }

    // ---------- 城市 Marker ----------
    function renderCities(cities) {
        markerLayer.clearLayers();
        markerById = {};
        state.cities = cities || [];

        if (!state.cities.length) return;

        var maxCount = 1;
        state.cities.forEach(function (c) { if (c.count > maxCount) maxCount = c.count; });

        state.cities.forEach(function (c) {
            if (c.lat === null || c.lng === null) return;

            // 半径 6-22px 按企业数分级
            var ratio = Math.sqrt(c.count / maxCount);
            var r = 6 + 16 * ratio;
            var font = ratio < 0.15 ? 'city-pin--sm' : (ratio < 0.5 ? 'city-pin--md' : 'city-pin--lg');

            var pin = L.divIcon({
                html: '<div>' + c.count + '</div>',
                className: 'city-pin ' + font,
                iconSize: L.point(r * 2, r * 2),
                iconAnchor: [r, r]
            });

            var marker = L.marker([c.lat, c.lng], { icon: pin });
            marker.bindPopup(
                '<b>' + escapeHtml(c.name) + '</b><br>' +
                escapeHtml(c.state || '') + (c.state ? ', ' : '') + escapeHtml(c.country) + '<br>' +
                '<span style="color:#0284c7;font-weight:700">' + c.count + '</span> companies'
            );
            marker.bindTooltip(c.name + ' (' + c.count + ')', { direction: 'top' });
            marker.on('click', function () { applyCityFilter(c.id, c.name); });

            markerLayer.addLayer(marker);
            markerById[c.id] = marker;
        });

        // 自动缩放
        var pts = state.cities.filter(function (c) { return c.lat !== null && c.lng !== null; });
        if (pts.length === 1) {
            map.flyTo([pts[0].lat, pts[0].lng], 9, { duration: 0.6 });
        } else if (pts.length > 1) {
            map.fitBounds(pts.map(function (c) { return [c.lat, c.lng]; }), {
                padding: [60, 60], maxZoom: 8
            });
        }
    }

    function focusMarker(cityId) {
        var m = markerById[cityId];
        if (m) {
            map.flyTo(m.getLatLng(), 9, { duration: 0.8 });
            setTimeout(function () { m.openPopup(); }, 800);
        }
    }

    // ---------- 企业列表 ----------
    function renderPlaceholder(icon, html) {
        $('results-list').innerHTML = '<div class="ms-hint"><span class="ms-hint__icon">' + icon + '</span>' + html + '</div>';
    }

    function cardHtml(c) {
        var place = [c.city, c.state, c.country].filter(Boolean).join(', ');
        var initial = escapeHtml((c.name || '?').trim().charAt(0).toUpperCase());
        var logo = c.logo
            ? '<img class="ms-card__logo" src="' + escapeHtml(c.logo) + '" alt="" loading="lazy" ' +
              'onerror="this.outerHTML=\'<div class=\\\'ms-card__logo-fb\\\'>' + initial + '</div>\'">'
            : '<div class="ms-card__logo-fb">' + initial + '</div>';

        return '<div class="ms-card" data-cid="' + c.cid + '" data-city-id="' + (c.city_id || '') + '" ' +
               'data-lat="' + (c.lat === null ? '' : c.lat) + '" data-lng="' + (c.lng === null ? '' : c.lng) + '">' +
               logo +
               '<div class="ms-card__body">' +
                   '<span class="ms-card__tag">' + escapeHtml(place) + '</span>' +
                   '<div class="ms-card__name" title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</div>' +
                   '<div class="ms-card__desc">' + escapeHtml(truncate(c.products, 130)) + '</div>' +
               '</div>' +
               '</div>';
    }

    function renderCompanies(list, append) {
        var container = $('results-list');
        var html = list.map(cardHtml).join('');
        if (append) {
            container.insertAdjacentHTML('beforeend', html);
        } else {
            container.innerHTML = html;
        }
        bindCardEvents(container);
    }

    function bindCardEvents(container) {
        container.querySelectorAll('.ms-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                var cid = parseInt(card.getAttribute('data-cid'), 10);
                // 点击卡片空白区 -> 高亮并打开详情
                openDetail(cid);
            });
        });
    }

    function updateSummary(total) {
        $('match-count').textContent = Number(total).toLocaleString();
    }

    function updateCityTag(name) {
        var el = $('city-tag');
        if (name) {
            el.style.display = 'inline-flex';
            $('city-tag-name').textContent = name;
        } else {
            el.style.display = 'none';
            $('city-tag-name').textContent = '';
        }
    }

    // ---------- API ----------
    function fetchResults(params) {
        var qs = Object.keys(params)
            .filter(function (k) { return params[k] !== '' && params[k] !== null && params[k] !== undefined; })
            .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
            .join('&');
        return fetch(API_URL + '?' + qs, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
    }

    function runSearch(resetCity) {
        var q = $('keyword-input').value.trim();
        $('clear-btn').style.display = q ? 'flex' : 'none';

        if (resetCity) {
            state.cityId = 0;
            state.cityName = '';
            updateCityTag(null);
        }

        if (q.length < 2) {
            state.q = '';
            state.page = 1;
            state.hasMore = false;
            state.companies = [];
            markerLayer.clearLayers();
            markerById = {};
            $('results-panel').style.display = 'none';
            $('empty-hint').style.display = 'block';
            closeDetail(); // 搜索结果关闭时，同时关闭右侧详情分屏
            map.flyTo([25, 10], 2, { duration: 0.5 });
            return;
        }

        state.q = q;
        state.page = 1;
        state.companies = [];
        $('results-panel').style.display = 'flex';
        $('empty-hint').style.display = 'none';
        saveRecent(q); // 保存最近搜索关键字

        var seq = ++state.seq;
        state.loading = true;
        $('list-loader').style.display = 'none';
        renderPlaceholder('⏳', 'Searching companies...');

        fetchResults({ q: q, city_id: state.cityId || '', page: 1 })
            .then(function (res) {
                if (seq !== state.seq) return;
                if (res.code !== 0) throw new Error(res.msg || 'error');

                var d = res.data;
                state.companies = d.companies;
                state.hasMore = d.has_more;
                state.page = d.page;

                updateSummary(d.total);
                renderCities(d.cities);

                if (d.total === 0) {
                    $('results-list').innerHTML = '';
                    renderPlaceholder('😕', 'No companies found for <b>"' + escapeHtml(q) + '"</b><br>Try another keyword.');
                } else {
                    renderCompanies(d.companies, false);
                }
                $('results-list').scrollTop = 0;
            })
            .catch(function () {
                if (seq !== state.seq) return;
                renderPlaceholder('⚠️', 'Search failed. Please try again.');
            })
            .then(function () { if (seq === state.seq) state.loading = false; });
    }

    function loadMore() {
        if (state.loading || !state.hasMore || !state.q) return;
        state.loading = true;
        $('list-loader').style.display = 'block';

        var seq = state.seq;
        var nextPage = state.page + 1;

        fetchResults({ q: state.q, city_id: state.cityId || '', page: nextPage })
            .then(function (res) {
                if (seq !== state.seq) return;
                if (res.code !== 0) throw new Error(res.msg || 'error');

                var d = res.data;
                state.companies = state.companies.concat(d.companies);
                renderCompanies(d.companies, true);
                state.page = d.page;
                state.hasMore = d.has_more;
                $('list-loader').style.display = 'none';
            })
            .catch(function () {
                if (seq === state.seq) $('list-loader').textContent = 'Load failed, please retry';
            })
            .then(function () { if (seq === state.seq) state.loading = false; });
    }

    // ---------- 城市筛选 ----------
    function applyCityFilter(cityId, cityName) {
        if (state.q.length < 2) return;
        state.cityId = cityId;
        state.cityName = cityName;
        updateCityTag(cityName);
        runSearch(false);
    }

    function clearCityFilter() {
        state.cityId = 0;
        state.cityName = '';
        updateCityTag(null);
        runSearch(false);
    }

    // ---------- 详情面板 ----------
    function openDetail(cid) {
        var c = state.companies.find(function (x) { return x.cid === cid; });
        if (!c) {
            // 没在当前页找到：可能是 marker 点击但该城市数据还没加载，先筛选城市
            var cityId = null;
            // 尝试从 DOM 找到卡片的 cityId（如果用户点击了已渲染的卡片）
            var card = document.querySelector('.ms-card[data-cid="' + cid + '"]');
            if (card) cityId = parseInt(card.getAttribute('data-city-id'), 10) || null;
            if (cityId) {
                applyCityFilter(cityId, '');
                return;
            }
            showHint('Please scroll down to load more results');
            return;
        }

        var place = [c.city, c.state, c.country].filter(Boolean).join(', ');
        var initial = escapeHtml((c.name || '?').trim().charAt(0).toUpperCase());

        var logoHtml = c.logo
            ? '<img class="dp-logo" src="' + escapeHtml(c.logo) + '" alt="" onerror="this.outerHTML=\'<div class=\\\'dp-logo-fb\\\'>' + initial + '</div>\'">'
            : '<div class="dp-logo-fb">' + initial + '</div>';

        // 信息行图标
        var icons = {
            pin:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>',
            user:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>',
            phone:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>',
            fax:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659"/></svg>',
            globe:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/></svg>',
            ext:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>'
        };
        function row(icon, content) {
            return '<div class="dp-row">' + icons[icon] + '<span>' + content + '</span></div>';
        }

        // 元信息徽章：成立年份 / 业务类型
        var meta = '';
        if (c.founded) meta += '<span class="dp-badge">Founded ' + escapeHtml(c.founded) + '</span>';
        if (c.biztype) meta += '<span class="dp-badge">' + escapeHtml(c.biztype) + '</span>';
        if (meta) meta = '<div class="dp-meta">' + meta + '</div>';

        var body = '' +
            logoHtml +
            '<div class="dp-place">' + escapeHtml(place) + '</div>' +
            '<div class="dp-name">' + escapeHtml(c.name) + '</div>' +
            meta +
            row('pin', escapeHtml([c.address, c.city].filter(Boolean).join(', ') || '—')) +
            (c.contact ? row('user', escapeHtml(c.contact)) : '') +
            (c.tel ? row('phone', 'Tel: ' + escapeHtml(c.tel)) : '') +
            (c.mobile ? row('phone', 'Mobile: ' + escapeHtml(c.mobile)) : '') +
            (c.fax ? row('fax', 'Fax: ' + escapeHtml(c.fax)) : '') +
            (c.website
                ? row('globe', '<a class="dp-link" href="http://' + escapeHtml(c.website) + '" target="_blank" rel="ugc noopener noreferrer nofollow">' + escapeHtml(c.website) + '</a>')
                : '') +
            '<div class="dp-label">Products</div>' +
            '<div class="dp-products">' + escapeHtml(c.products || '—') + '</div>' +
            (c.intro
                ? '<div class="dp-label">About</div><div class="dp-products">' + escapeHtml(truncate(c.intro, 500)) + '</div>'
                : '') +
            (c.url
                ? '<a class="dp-view" href="' + escapeHtml(c.url) + '" target="_blank">' + icons.ext + 'View Company Profile</a>'
                : '');

        $('detail-body').innerHTML = body;
        $('detail-panel').classList.add('is-open');
        document.body.classList.add('detail-open'); // 移动端隐藏浮动控件，避免遮挡详情面板
        detailPanelOpen = true;
        refreshMapSize();

        // 地图定位（面板展开后地图已缩小，继续在该区域居中）
        if (c.lat !== null && c.lng !== null) {
            map.flyTo([c.lat, c.lng], 11, { duration: 0.8 });
            focusMarker(c.city_id);
        }
    }

    function closeDetail() {
        $('detail-panel').classList.remove('is-open');
        document.body.classList.remove('detail-open');
        detailPanelOpen = false;
        refreshMapSize();
    }

    function showHint(msg) {
        // 用 toast 提示；复用已有的 toast.js 如果可用，否则 alert
        if (typeof window.showToast === 'function') {
            window.showToast(msg, 'info');
        } else {
            alert(msg);
        }
    }

    // ---------- 交互绑定 ----------
    function init() {
        initMap();
        renderRecent(); // 加载本地保存的最近搜索

        // 搜索框：Enter 触发；input 只控制清除按钮
        $('keyword-input').addEventListener('input', function () {
            $('clear-btn').style.display = this.value.trim() ? 'flex' : 'none';
        });
        $('keyword-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); runSearch(true); }
        });
        $('search-btn').addEventListener('click', function () { runSearch(true); });
        $('clear-btn').addEventListener('click', function () {
            $('keyword-input').value = '';
            $('clear-btn').style.display = 'none';
            runSearch(true);
            $('keyword-input').focus();
        });

        // 快捷 chips
        document.querySelectorAll('.chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('is-active'); });
                chip.classList.add('is-active');
                $('keyword-input').value = chip.getAttribute('data-q');
                runSearch(true);
            });
        });

        // 结果面板展开/收起
        $('results-collapse').addEventListener('click', function () {
            $('results-panel').classList.toggle('is-collapsed');
            refreshMapSize();
        });

        // 城市筛选清除
        $('city-tag-clear').addEventListener('click', clearCityFilter);

        // 滚动加载
        $('results-list').addEventListener('scroll', function () {
            var el = this;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
                loadMore();
            }
        });

        // 详情面板关闭
        $('detail-close').addEventListener('click', closeDetail);

        // 图层切换
        $('layer-btn').addEventListener('click', function () {
            var card = $('layer-card');
            card.style.display = card.style.display === 'none' ? 'flex' : 'none';
        });
        document.querySelectorAll('.layer-card__opt').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.layer-card__opt').forEach(function (b) { b.classList.remove('is-active'); });
                btn.classList.add('is-active');
                switchTileLayer(btn.getAttribute('data-layer'));
                $('layer-card').style.display = 'none';
            });
        });

        // 定位
        $('locate-btn').addEventListener('click', locateUser);

        // 缩放
        $('zoom-in').addEventListener('click', function () { map.zoomIn(); });
        $('zoom-out').addEventListener('click', function () { map.zoomOut(); });

        // 点击地图空白处关闭详情（可选）
        map.on('click', function () {
            if (detailPanelOpen) closeDetail();
        });
    }

    window.addEventListener('DOMContentLoaded', init);
})();
