/* ============================================
   HESPOIRE — Movie & Series Streaming App
   ============================================ */

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------
const CONFIG = {
    TMDB_KEY: '06e955fa0b338a170d7b8dc9710016b0',
    // Deploy Consumet API (https://github.com/consumet/api.consumet.org) and paste the URL here
    CONSUMET_BASE: 'https://api.hespoire.com',
    IMG: 'https://image.tmdb.org/t/p/',
    POSTER: 'w500',
    BACKDROP: 'original',
    PROFILE: 'w185',
};

// ------------------------------------------------------------------
// KEYAUTH
// ------------------------------------------------------------------
const KEYAUTH = {
    name: 'Strynic',
    ownerid: 'AP66ZLWgIM',
    ver: '1.0',
    sessionid: null,

    async init() {
        try {
            const res = await fetch('https://keyauth.win/api/1.2/', {
                method: 'POST',
                body: new URLSearchParams({ type: 'init', ver: this.ver, name: this.name, ownerid: this.ownerid }),
            });
            const data = await res.json();
            if (data.success) { this.sessionid = data.sessionid; return true; }
            return false;
        } catch (e) { console.error('KeyAuth init error:', e); return false; }
    },

    // Register: first-time activation (username + key)
    async register(username, key) {
        if (!this.sessionid) { const ok = await this.init(); if (!ok) return { success: false, message: 'Could not connect to server. Try again.' }; }
        try {
            const res = await fetch('https://keyauth.win/api/1.2/', {
                method: 'POST',
                body: new URLSearchParams({
                    type: 'register', username, pass: key, key,
                    sessionid: this.sessionid, name: this.name,
                    ownerid: this.ownerid, hwid: this.hwid(),
                }),
            });
            return await res.json();
        } catch (e) { return { success: false, message: 'Network error. Try again.' }; }
    },

    // Login: returning user (username + key as password)
    async login(username, pass) {
        if (!this.sessionid) { const ok = await this.init(); if (!ok) return { success: false, message: 'Could not connect to server. Try again.' }; }
        try {
            const res = await fetch('https://keyauth.win/api/1.2/', {
                method: 'POST',
                body: new URLSearchParams({
                    type: 'login', username, pass,
                    sessionid: this.sessionid, name: this.name,
                    ownerid: this.ownerid, hwid: this.hwid(),
                }),
            });
            return await res.json();
        } catch (e) { return { success: false, message: 'Network error. Try again.' }; }
    },

    hwid() { return 'HespoireWebApplication0'; },
};

// ------------------------------------------------------------------
// AUTH (KeyAuth-powered, works across devices)
// ------------------------------------------------------------------
const Auth = {
    session()  { return JSON.parse(localStorage.getItem('hesp_session') || 'null'); },
    loggedIn() { return this.session() !== null; },

    async activate(key, displayName) {
        // Use key as the KeyAuth username — it's the sole identity
        let result = await KEYAUTH.register(key, key);
        console.log('[KeyAuth register]', JSON.stringify(result));

        if (!result.success) {
            const msg = (result.message || '').toLowerCase();
            const shouldTryLogin =
                msg.includes('username already') ||
                msg.includes('already exist') ||
                msg.includes('already taken') ||
                msg.includes('already used') ||
                msg.includes('key already') ||
                msg.includes('already registered');
            if (shouldTryLogin) {
                await KEYAUTH.init();
                result = await KEYAUTH.login(key, key);
                console.log('[KeyAuth login fallback]', JSON.stringify(result));
            }
        }

        if (!result.success) return result.message || 'Invalid license key';

        const sub = result.info?.subscriptions?.[0];
        // Preserve existing display name if already set (returning user)
        const existing = Auth.session();
        const session = {
            id: key,
            displayName: displayName || existing?.displayName || 'Member',
            key,
            plan: sub?.subscription || 'Classic',
            expiry: sub?.expiry || null,
        };
        localStorage.setItem('hesp_session', JSON.stringify(session));
        return null;
    },

    logout() {
        localStorage.removeItem('hesp_session');
        location.reload();
    },

    // Don't re-call license endpoint — it consumes the key.
    // Just trust the stored session. Keys are validated on first login only.
    // To revoke access, delete the key from your KeyAuth dashboard.
    validate() { return this.session() !== null; },
};

// ------------------------------------------------------------------
// WATCH HISTORY (per-user, localStorage)
// ------------------------------------------------------------------
const WatchHistory = {
    _key() {
        const s = Auth.session();
        return s ? `hesp_hist_${s.id}` : null;
    },

    getAll() {
        const k = this._key();
        return k ? JSON.parse(localStorage.getItem(k) || '[]') : [];
    },

    save(item) {
        const k = this._key();
        if (!k) return;
        const prev = this.get(item.id, item.type);
        let hist = this.getAll().filter(h => !(h.id === item.id && h.type === item.type));
        // Preserve resume position when re-opening the same episode
        const sameEp = prev && prev.season === (item.season || null) && prev.episode === (item.episode || null);
        hist.unshift({
            id: item.id,
            type: item.type,
            title: item.title,
            poster: item.poster,
            season: item.season || null,
            episode: item.episode || null,
            position: sameEp ? (prev.position || 0) : 0,
            duration: sameEp ? (prev.duration || 0) : 0,
            at: Date.now(),
        });
        localStorage.setItem(k, JSON.stringify(hist.slice(0, 50)));
    },

    // Update the exact playback position for the currently-watching title
    savePosition(id, type, position, duration) {
        const k = this._key();
        if (!k) return;
        const hist = this.getAll();
        const h = hist.find(x => x.id === id && x.type === type);
        if (!h) return;
        h.position = Math.floor(position);
        h.duration = Math.floor(duration);
        h.at = Date.now();
        localStorage.setItem(k, JSON.stringify(hist));
    },

    get(id, type) {
        return this.getAll().find(h => h.id === id && h.type === type) || null;
    },
};

// ------------------------------------------------------------------
// TMDB API
// ------------------------------------------------------------------
const TMDB = {
    async f(path, params = {}) {
        params.api_key = CONFIG.TMDB_KEY;
        const qs = new URLSearchParams(params).toString();
        const r = await fetch(`https://api.themoviedb.org/3${path}?${qs}`);
        if (!r.ok) throw new Error(`TMDB ${r.status}`);
        return r.json();
    },
    trending()            { return this.f('/trending/all/week'); },
    popularMovies(p)      { return this.f('/movie/popular', { page: p }); },
    popularTV(p)          { return this.f('/tv/popular', { page: p }); },
    topMovies(p)          { return this.f('/movie/top_rated', { page: p }); },
    topTV(p)              { return this.f('/tv/top_rated', { page: p }); },
    discoverMovies(p, g)  { const o = { page: p, sort_by: 'popularity.desc' }; if (g) o.with_genres = g; return this.f('/discover/movie', o); },
    discoverTV(p, g)      { const o = { page: p, sort_by: 'popularity.desc' }; if (g) o.with_genres = g; return this.f('/discover/tv', o); },
    searchMulti(q, p)     { return this.f('/search/multi', { query: q, page: p }); },
    movieDetail(id)       { return this.f(`/movie/${id}`, { append_to_response: 'credits,videos' }); },
    tvDetail(id)          { return this.f(`/tv/${id}`, { append_to_response: 'credits,videos' }); },
    tvSeason(id, num)     { return this.f(`/tv/${id}/season/${num}`); },
    movieGenres()         { return this.f('/genre/movie/list'); },
    tvGenres()            { return this.f('/genre/tv/list'); },
};

function mapItem(r) {
    const tv = r.media_type === 'tv' || r.first_air_date !== undefined;
    return {
        id: r.id,
        title: r.title || r.name || '',
        type: tv ? 'tv' : 'movie',
        year: ((r.release_date || r.first_air_date) || '').substring(0, 4),
        rating: r.vote_average ? +r.vote_average.toFixed(1) : 0,
        poster: r.poster_path ? CONFIG.IMG + CONFIG.POSTER + r.poster_path : null,
        backdrop: r.backdrop_path ? CONFIG.IMG + CONFIG.BACKDROP + r.backdrop_path : null,
        desc: r.overview || '',
        genres: r.genres ? r.genres.map(g => g.name) : [],
        runtime: r.runtime || null,
        seasons: r.number_of_seasons || null,
        seasonsData: r.seasons || null,
        tagline: r.tagline || '',
        cast: [],
        trailer: null,
    };
}

function mapDetail(r, type) {
    const m = mapItem({ ...r, media_type: type });
    if (r.credits?.cast) {
        m.cast = r.credits.cast.slice(0, 12).map(c => ({
            name: c.name, character: c.character,
            photo: c.profile_path ? CONFIG.IMG + CONFIG.PROFILE + c.profile_path : null,
        }));
    }
    const tr = r.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    if (tr) m.trailer = tr.key;
    if (r.genres) m.genres = r.genres.map(g => g.name);
    return m;
}

// ------------------------------------------------------------------
// STREAM API — IMDB lookup via our server, torrent search in browser
// ------------------------------------------------------------------
const TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://opentracker.i2p.rocks:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
].map(t => `&tr=${encodeURIComponent(t)}`).join('');

function parseQuality(s = '') {
    if (/2160p|4K|UHD/i.test(s)) return '4K';
    if (/1080p/i.test(s)) return '1080p';
    if (/720p/i.test(s)) return '720p';
    if (/480p/i.test(s)) return '480p';
    return 'SD';
}

const API_HEADERS = { 'ngrok-skip-browser-warning': 'true' };

const StreamAPI = {
    async getStreams(tmdbId, type, season = 1, episode = 1) {
        if (!CONFIG.CONSUMET_BASE) throw new Error('No API configured');
        const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');

        // 1. Get IMDB ID from our server (also doubles as a reachability check)
        let idRes;
        try {
            idRes = await fetch(`${base}/imdb/${tmdbId}?type=${type}`, { headers: API_HEADERS });
        } catch (e) {
            throw new Error('Hespoire server is offline right now. Please try again later.');
        }
        const idData = await idRes.json();
        if (!idRes.ok) throw new Error(idData.message || 'Could not get IMDB ID');
        const imdbId = idData.imdbId;
        this.lastImdbId = imdbId;

        // 2. Torrentio first (aggregates many indexers + season packs w/ fileIdx)
        let streams = await this._torrentio(imdbId, type, season, episode);

        // 3. Supplement with YTS (movies) / EZTV (tv) if Torrentio is thin
        if (streams.length < 4) {
            const extra = type === 'movie'
                ? await this._yts(imdbId)
                : await this._eztv(imdbId, season, episode);
            streams = streams.concat(extra);
        }

        // Dedupe by infohash
        const seen = new Set();
        streams = streams.filter(s => {
            const h = (s.magnet.match(/btih:([a-z0-9]+)/i) || [])[1]?.toLowerCase();
            if (!h || seen.has(h)) return false;
            seen.add(h); return true;
        });

        // Rank: prefer well-seeded H.264 (plays via fast copy, no stutter)
        // over HEVC (needs CPU-heavy realtime re-encode). Fall back to HEVC only if needed.
        streams.sort((a, b) => {
            const aGood = (!a.hevc && a.seeders >= 8) ? 1 : 0;
            const bGood = (!b.hevc && b.seeders >= 8) ? 1 : 0;
            if (aGood !== bGood) return bGood - aGood;
            return b.seeders - a.seeders;
        });

        if (!streams.length) throw new Error('No streams found for this title');
        return streams.map((s, i) => ({ ...s, id: i }));
    },

    async _torrentio(imdbId, type, season, episode) {
        try {
            const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');
            const url = type === 'movie'
                ? `${base}/proxy/torrentio/movie/${imdbId}`
                : `${base}/proxy/torrentio/series/${imdbId}?season=${season}&episode=${episode}`;
            const res = await fetch(url, { headers: API_HEADERS });
            const data = await res.json();
            return (data.streams || []).filter(s => s.infoHash).map(s => {
                const meta = `${s.name || ''} ${s.title || ''}`;
                const seedM = (s.title || '').match(/👤\s*(\d+)/);
                const sizeM = (s.title || '').match(/💾\s*([\d.]+\s*[GM]B)/);
                const q = /2160p|4k|uhd/i.test(meta) ? '4K' : /1080p/i.test(meta) ? '1080p' : /720p/i.test(meta) ? '720p' : 'SD';
                const hevc = /x265|hevc|h\.?265/i.test(meta);
                const isMp4 = /\.mp4/i.test(s.title || '') || /x264|h\.?264|avc/i.test(meta);
                return {
                    quality: q + (hevc ? ' · x265' : ''),
                    seeders: seedM ? +seedM[1] : 0,
                    size: sizeM ? sizeM[1] : '',
                    magnet: `magnet:?xt=urn:btih:${s.infoHash}${TRACKERS}`,
                    fileIdx: s.fileIdx || 0,
                    hevc,
                    // TV & anything non-mp4/HEVC goes through the transcoder; clean mp4 movies stream direct
                    hls: type === 'tv' || hevc || !isMp4,
                };
            });
        } catch (e) {
            console.warn('Torrentio failed:', e.message);
            return [];
        }
    },

    async _yts(imdbId) {
        try {
            const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');
            const res = await fetch(`${base}/proxy/yts/${imdbId}`, { headers: API_HEADERS });
            const data = await res.json();
            const movie = data.data?.movie;
            if (!movie) return [];
            return (movie.torrents || []).map((t, i) => ({
                id: i,
                quality: t.quality + (t.video_codec ? ' · ' + t.video_codec : ''),
                seeders: t.seeds || 0,
                size: t.size || '',
                magnet: `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(movie.title_long)}${TRACKERS}`,
                fileIdx: 0,
                hls: false, // YTS = mp4, plays directly
            })).sort((a, b) => b.seeders - a.seeders);
        } catch (e) {
            console.warn('YTS failed:', e.message);
            return [];
        }
    },

    async _eztv(imdbId, season, episode) {
        try {
            const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');
            const res = await fetch(`${base}/proxy/eztv/${imdbId}`, { headers: API_HEADERS });
            const data = await res.json();
            return (data.torrents || [])
                .filter(t => {
                    const m = (t.title || '').match(/S(\d+)E(\d+)/i);
                    return m && +m[1] === +season && +m[2] === +episode;
                })
                .map((t, i) => ({
                    id: i,
                    quality: parseQuality(t.title),
                    seeders: t.seeds || 0,
                    size: t.size_bytes ? (t.size_bytes / 1e9).toFixed(1) + ' GB' : '',
                    magnet: t.magnet_url || `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(t.title)}${TRACKERS}`,
                    fileIdx: 0,
                    hls: true, // EZTV = mkv/eac3, needs server transcode to HLS
                }))
                .sort((a, b) => b.seeders - a.seeders);
        } catch (e) {
            console.warn('EZTV failed:', e.message);
            return [];
        }
    },
};

// ------------------------------------------------------------------
// CUSTOM PLAYER (WebTorrent)
// ------------------------------------------------------------------
const CustomPlayer = {
    hls: null,
    statsInterval: null,
    hideTimer: null,
    seeking: false,
    streams: [],
    current: null,      // { id, type, season, episode, title }
    resumeAt: 0,        // seconds to resume to on next loadedmetadata
    _lastSave: 0,       // throttle for savePosition
    subOn: localStorage.getItem('hesp_subs') !== '0', // subtitles on by default
    _retryFn: null,

    init() {
        const video = document.getElementById('playerVideo');
        const ui = document.getElementById('playerUI');
        const overlay = document.getElementById('playerOverlay');

        const show = () => {
            ui.classList.add('visible');
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (!video.paused) ui.classList.remove('visible');
            }, 3000);
        };

        overlay.addEventListener('mousemove', show);
        overlay.addEventListener('touchstart', () => {
            ui.classList.contains('visible') ? ui.classList.remove('visible') : show();
        }, { passive: true });

        document.getElementById('playerClickZone').addEventListener('click', () => this.togglePlay());
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlay());
        document.getElementById('muteBtn').addEventListener('click', () => this.toggleMute());
        document.getElementById('playerFsBtn').addEventListener('click', () => this.toggleFs());
        document.addEventListener('fullscreenchange', () => this.renderFsBtn());

        const volRange = document.getElementById('volRange');
        volRange.addEventListener('input', () => {
            video.volume = +volRange.value;
            video.muted = video.volume === 0;
            this.renderMuteBtn();
            this.saveVolume();
        });

        // Restore saved volume/mute from last session
        const savedVol = parseFloat(localStorage.getItem('hesp_volume'));
        const savedMuted = localStorage.getItem('hesp_muted') === '1';
        if (!isNaN(savedVol)) { video.volume = savedVol; volRange.value = savedVol; }
        video.muted = savedMuted;
        this.renderMuteBtn();

        const seekEl = document.getElementById('playerSeek');
        seekEl.addEventListener('mousedown', e => this.startSeek(e));
        seekEl.addEventListener('touchstart', e => this.startSeek(e), { passive: true });
        document.addEventListener('mousemove', e => this.doSeek(e));
        document.addEventListener('touchmove', e => this.doSeek(e), { passive: true });
        document.addEventListener('mouseup', () => this.endSeek());
        document.addEventListener('touchend', () => this.endSeek());

        video.addEventListener('play', () => { this.renderPlayBtn(); overlay.classList.add('is-playing'); });
        video.addEventListener('pause', () => { this.renderPlayBtn(); overlay.classList.remove('is-playing'); ui.classList.add('visible'); clearTimeout(this.hideTimer); this.savePosition(); });
        video.addEventListener('waiting', () => this.loader(true));
        video.addEventListener('playing', () => this.loader(false));
        video.addEventListener('canplay', () => this.loader(false));
        video.addEventListener('timeupdate', () => { this.renderProgress(); this.savePosition(); });
        video.addEventListener('progress', () => this.renderBuffered());
        // Resume where the user left off (direct mp4; HLS uses Hls startPosition)
        video.addEventListener('loadedmetadata', () => {
            const r = this.resumeAt || 0;
            if (!this.hls && r > 10 && r < video.duration - 15) { try { video.currentTime = r; } catch {} }
        });
        video.addEventListener('ended', () => {
            this.renderPlayBtn(); overlay.classList.remove('is-playing'); ui.classList.add('visible'); clearTimeout(this.hideTimer);
            if (this.current) WatchHistory.savePosition(this.current.id, this.current.type, 0, video.duration); // mark finished
            this.maybeAutoNext();
        });

        document.getElementById('playerQuality').addEventListener('change', e => this.loadStream(+e.target.value));

        document.getElementById('ccBtn').addEventListener('click', () => this.toggleSubs());
        document.getElementById('bigPlayBtn').addEventListener('click', () => this.togglePlay());

        document.addEventListener('keydown', e => {
            if (!overlay.classList.contains('active')) return;
            if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
            switch (e.key) {
                case ' ': case 'k': e.preventDefault(); this.togglePlay(); show(); break;
                case 'f': e.preventDefault(); this.toggleFs(); break;
                case 'm': e.preventDefault(); this.toggleMute(); break;
                case 'ArrowRight': e.preventDefault(); video.currentTime += 10; show(); break;
                case 'ArrowLeft': e.preventDefault(); video.currentTime -= 10; show(); break;
                case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); volRange.value = video.volume; video.muted = false; this.renderMuteBtn(); this.saveVolume(); break;
                case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); volRange.value = video.volume; this.renderMuteBtn(); this.saveVolume(); break;
            }
        });

        this.renderPlayBtn(); this.renderMuteBtn(); this.renderFsBtn();
    },

    async load(tmdbId, type, season, episode, retryFn) {
        this._retryFn = retryFn;
        this.loader(true);
        this.err(false);
        this.destroyTorrent();

        try {
            const streams = await StreamAPI.getStreams(tmdbId, type, season, episode);
            if (!streams.length) throw new Error('No streams found');
            this.streams = streams;

            const sel = document.getElementById('playerQuality');
            sel.innerHTML = streams.map((s, i) =>
                `<option value="${i}">${s.quality}${s.size ? ' · ' + s.size : ''}${s.seeders ? ' · ' + s.seeders + ' 👤' : ''}</option>`
            ).join('');
            sel.style.display = streams.length > 1 ? 'block' : 'none';

            this.loadStream(0);
            // Fetch subtitles in parallel (non-blocking)
            this.loadSubtitles(StreamAPI.lastImdbId, type, season, episode);
        } catch (e) {
            console.error('[Player]', e);
            this.loader(false);
            this.err(true, e.message);
        }
    },

    loadStream(index) {
        const stream = this.streams[index];
        const video = document.getElementById('playerVideo');
        const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');

        this.destroyTorrent();

        if (!stream) {
            // Ran out of sources to try
            this.loader(false);
            this.err(true, 'No working source found — this title may not have active seeders right now.');
            return;
        }

        this._streamIndex = index;
        this._currentMagnet = stream.magnet;
        this.loader(true);
        this.loaderText(index > 0 ? `Trying another source (${index + 1}/${this.streams.length})…` : 'Loading stream…');

        // Watchdog: if playback hasn't started, fail over to the next source
        clearTimeout(this._watchdog);
        this._watchdog = setTimeout(() => {
            if (video.readyState < 3) {
                console.warn(`Source ${index} stalled, trying next`);
                this.loadStream(index + 1);
            }
        }, 70000);

        const onPlaying = () => { clearTimeout(this._watchdog); video.removeEventListener('playing', onPlaying); };
        video.addEventListener('playing', onPlaying);

        // Direct (mp4) failures should also fail over
        video.onerror = () => { if (video.readyState < 3) this.loadStream(index + 1); };

        const fidx = stream.fileIdx != null ? `&fileIdx=${stream.fileIdx}` : '';

        if (stream.hls) {
            // MKV/HEVC/TV: server transcodes to HLS, play with hls.js
            fetch(`${base}/hls/start?magnet=${encodeURIComponent(stream.magnet)}${fidx}`, { headers: API_HEADERS })
                .then(async r => {
                    if (r.status === 503) { const d = await r.json().catch(() => ({})); throw { busy: true, msg: d.message || 'Server busy' }; }
                    return r.json();
                })
                .then(({ url, message }) => {
                    if (!url) throw new Error(message || 'Transcode failed');
                    const full = base + url;
                    if (window.Hls && Hls.isSupported()) {
                        this.hls = new Hls({
                            maxBufferLength: 30,
                            manifestLoadingMaxRetry: 6,
                            manifestLoadingRetryDelay: 1000,
                            levelLoadingMaxRetry: 6,
                            fragLoadingMaxRetry: 8,
                            fragLoadingRetryDelay: 1000,
                            // Resume where the user left off (hls.js handles the seek)
                            startPosition: (this.resumeAt > 10) ? this.resumeAt : -1,
                        });
                        this._hlsRecover = 0;
                        this.hls.loadSource(full);
                        this.hls.attachMedia(video);
                        this.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
                        this.hls.on(Hls.Events.FRAG_LOADED, () => { this._hlsRecover = 0; });
                        this.hls.on(Hls.Events.ERROR, (_, d) => {
                            if (!d.fatal) return;
                            if (this._hlsRecover < 5) {
                                this._hlsRecover++;
                                if (d.type === Hls.ErrorTypes.MEDIA_ERROR) this.hls.recoverMediaError();
                                else this.hls.startLoad();
                            } else {
                                // This source is dead — fail over to the next
                                this.loadStream(index + 1);
                            }
                        });
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = full;
                        video.play().catch(() => {});
                    } else {
                        throw new Error('HLS not supported in this browser');
                    }
                })
                .catch(e => {
                    if (e && e.busy) {
                        // Server at capacity — don't spam other sources, tell the user
                        clearTimeout(this._watchdog);
                        this.loader(false);
                        this.err(true, e.msg);
                    } else {
                        this.loadStream(index + 1);
                    }
                });
        } else {
            // mp4 (movies): server streams the file directly
            video.src = `${base}/stream?magnet=${encodeURIComponent(stream.magnet)}${fidx}`;
            video.play().catch(() => {});
        }

        clearInterval(this.statsInterval);
        this.statsInterval = setInterval(() => this.pollStats(stream.magnet), 2000);
    },

    loaderText(txt) {
        const el = document.querySelector('#playerLoader span');
        if (el) el.textContent = txt;
    },

    async pollStats(magnet) {
        try {
            const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');
            const res = await fetch(`${base}/stream-stats?magnet=${encodeURIComponent(magnet)}`, { headers: API_HEADERS });
            const s = await res.json();
            const el = document.getElementById('playerStats');
            if (!el) return;
            const speed = (s.speed / 1024 / 1024).toFixed(1);
            el.textContent = s.peers ? `↓ ${speed} MB/s · ${s.peers} peers` : 'Connecting to peers…';
        } catch (e) { /* ignore */ }
    },

    retry() { if (this._retryFn) this._retryFn(); },

    destroyTorrent() {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
        clearTimeout(this._watchdog);
        if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
        const video = document.getElementById('playerVideo');
        if (video) { video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); }
        const statsEl = document.getElementById('playerStats');
        if (statsEl) statsEl.textContent = '';
    },

    destroy() {
        this.savePosition(true);
        clearInterval(this._autoNextTimer);
        document.getElementById('autoNextBar')?.remove();
        this.destroyTorrent();
        clearTimeout(this.hideTimer);
        document.getElementById('playerUI')?.classList.remove('visible');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },

    togglePlay() {
        const v = document.getElementById('playerVideo');
        v.paused ? v.play().catch(() => {}) : v.pause();
    },

    toggleMute() {
        const v = document.getElementById('playerVideo');
        v.muted = !v.muted;
        if (!v.muted && v.volume === 0) v.volume = 0.5;
        document.getElementById('volRange').value = v.muted ? 0 : v.volume;
        this.renderMuteBtn();
        this.saveVolume();
    },

    saveVolume() {
        const v = document.getElementById('playerVideo');
        localStorage.setItem('hesp_volume', v.volume);
        localStorage.setItem('hesp_muted', v.muted ? '1' : '0');
    },

    async loadSubtitles(imdbId, type, season, episode) {
        const video = document.getElementById('playerVideo');
        // Clear any previous track
        [...video.querySelectorAll('track')].forEach(t => t.remove());
        this._subReady = false;
        document.getElementById('ccBtn').style.display = 'none';
        if (!imdbId) return;
        try {
            const base = CONFIG.CONSUMET_BASE.replace(/\/$/, '');
            let url = `${base}/subtitles/${imdbId}?lang=en`;
            if (type === 'tv') url += `&season=${season}&episode=${episode}`;
            const r = await fetch(url, { headers: API_HEADERS });
            if (!r.ok) return; // no subs / not configured — leave CC hidden
            const vtt = await r.text();
            const blob = new Blob([vtt], { type: 'text/vtt' });
            const track = document.createElement('track');
            track.kind = 'subtitles'; track.label = 'English'; track.srclang = 'en';
            track.src = URL.createObjectURL(blob);
            video.appendChild(track);
            // Browsers need a tick before textTracks[0] exists
            setTimeout(() => {
                const tt = video.textTracks[0];
                if (tt) tt.mode = this.subOn ? 'showing' : 'hidden';
            }, 100);
            this._subReady = true;
            document.getElementById('ccBtn').style.display = 'flex';
            this.renderCcBtn();
        } catch (e) { /* ignore */ }
    },

    toggleSubs() {
        const video = document.getElementById('playerVideo');
        const tt = video.textTracks[0];
        if (!tt) return;
        this.subOn = !this.subOn;
        tt.mode = this.subOn ? 'showing' : 'hidden';
        localStorage.setItem('hesp_subs', this.subOn ? '1' : '0');
        this.renderCcBtn();
    },

    renderCcBtn() {
        const btn = document.getElementById('ccBtn');
        if (btn) btn.style.color = (this.subOn && this._subReady) ? 'var(--accent)' : 'rgba(255,255,255,0.85)';
    },

    // Persist playback position (throttled to ~5s) so we can resume later
    savePosition(force) {
        if (!this.current) return;
        const v = document.getElementById('playerVideo');
        if (!v.duration || isNaN(v.duration)) return;
        const now = Date.now();
        if (!force && now - this._lastSave < 5000) return;
        this._lastSave = now;
        WatchHistory.savePosition(this.current.id, this.current.type, v.currentTime, v.duration);
    },

    // When a TV episode ends, offer/auto-play the next one
    maybeAutoNext() {
        const c = this.current;
        if (!c || c.type !== 'tv') return;
        const nextEp = (c.episode || 1) + 1;
        const overlay = document.getElementById('playerOverlay');

        // Build a small "Up next" prompt with a countdown
        let bar = document.getElementById('autoNextBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'autoNextBar';
            bar.className = 'auto-next-bar';
            overlay.appendChild(bar);
        }
        let secs = 8;
        const render = () => {
            bar.innerHTML = `<span>Up next · S${c.season}E${nextEp}</span>
                <button class="btn btn-primary auto-next-go">Play now (${secs})</button>
                <button class="auto-next-cancel">Cancel</button>`;
            bar.querySelector('.auto-next-go').onclick = () => { clearInterval(t); bar.remove(); App.openPlayer(c.id, 'tv', c.season, nextEp); };
            bar.querySelector('.auto-next-cancel').onclick = () => { clearInterval(t); bar.remove(); };
        };
        render();
        const t = setInterval(() => {
            secs--;
            if (secs <= 0) { clearInterval(t); bar.remove(); App.openPlayer(c.id, 'tv', c.season, nextEp); }
            else render();
        }, 1000);
        this._autoNextTimer = t;
    },

    toggleFs() {
        const el = document.getElementById('playerOverlay');
        const video = document.getElementById('playerVideo');

        // Already in standard fullscreen → exit
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            return;
        }

        // Standard Fullscreen API (desktop, Android Chrome) — fullscreens our custom UI
        if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => this.iosFullscreen(video));
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        } else {
            // iOS Safari: only the <video> element can go fullscreen (native controls)
            this.iosFullscreen(video);
        }
    },

    iosFullscreen(video) {
        if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else if (video.webkitSupportsFullscreen) video.webkitEnterFullscreen();
    },

    startSeek(e) { this.seeking = true; this.doSeek(e); },
    doSeek(e) {
        if (!this.seeking) return;
        const seekEl = document.getElementById('playerSeek');
        const rect = seekEl.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX);
        const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * 100;
        document.getElementById('seekPlayed').style.width = pct + '%';
        document.getElementById('seekThumb').style.left = pct + '%';
    },
    endSeek() {
        if (!this.seeking) return;
        this.seeking = false;
        const video = document.getElementById('playerVideo');
        const pct = parseFloat(document.getElementById('seekPlayed').style.width || '0') / 100;
        if (video.duration) video.currentTime = pct * video.duration;
    },

    renderPlayBtn() {
        const v = document.getElementById('playerVideo');
        const playIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        const pauseIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        document.getElementById('playPauseBtn').innerHTML = v.paused ? playIcon : pauseIcon;
        const big = document.getElementById('bigPlayBtn');
        if (big) big.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    },
    renderMuteBtn() {
        const v = document.getElementById('playerVideo');
        const muted = v.muted || v.volume === 0;
        document.getElementById('muteBtn').innerHTML = muted
            ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
            : `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    },
    renderFsBtn() {
        document.getElementById('playerFsBtn').innerHTML = document.fullscreenElement
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
    },

    renderProgress() {
        const v = document.getElementById('playerVideo');
        if (!v.duration || this.seeking) return;
        const pct = (v.currentTime / v.duration) * 100;
        document.getElementById('seekPlayed').style.width = pct + '%';
        document.getElementById('seekThumb').style.left = pct + '%';
        document.getElementById('playerTimeDisp').textContent = `${this.fmt(v.currentTime)} / ${this.fmt(v.duration)}`;
    },
    renderBuffered() {
        const v = document.getElementById('playerVideo');
        if (!v.duration || !v.buffered.length) return;
        const pct = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100;
        document.getElementById('seekBuffered').style.width = pct + '%';
    },

    loader(show) {
        const el = document.getElementById('playerLoader');
        if (el) el.style.display = show ? 'flex' : 'none';
        document.getElementById('playerOverlay')?.classList.toggle('is-loading', !!show);
    },
    err(show, msg = '') {
        const el = document.getElementById('playerErr');
        if (!el) return;
        el.style.display = show ? 'flex' : 'none';
        if (msg) { const m = document.getElementById('playerErrMsg'); if (m) m.textContent = msg; }
    },
    fmt(s) {
        s = Math.floor(s);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },
};

// ------------------------------------------------------------------
// STATE
// ------------------------------------------------------------------
let state = {
    page: 'home', activeGenre: '',
    movieGenres: [], tvGenres: [],
    moviesPage: 1, seriesPage: 1,
    moviesCache: [], seriesCache: [],
    hasMoreMovies: true, hasMoreSeries: true,
    allItems: [], searchQuery: '',
};

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function starSVG() { return '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>'; }
function playSVG(s=16) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="#0a0a0f"><path d="M8 5v14l11-7z"/></svg>`; }
function arrowSVG(d) { return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="${d==='left'?'M15 18l-6-6 6-6':'M9 18l6-6-6-6'}"/></svg>`; }

function posterHTML(item) {
    if (item.poster) return `<img src="${esc(item.poster)}" alt="${esc(item.title)}" loading="lazy">`;
    return `<div class="card-placeholder" style="background:linear-gradient(135deg,#1a1a2e,#16213e)">${esc(item.title)}</div>`;
}

function getEmbedURL(tmdbId, type, season, episode) {
    if (type === 'tv' && CONFIG.TV_EMBED) return CONFIG.TV_EMBED.replace('{id}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
    if (type === 'movie' && CONFIG.MOVIE_EMBED) return CONFIG.MOVIE_EMBED.replace('{id}', tmdbId);
    return '';
}

// ------------------------------------------------------------------
// RENDER: CARDS & ROWS
// ------------------------------------------------------------------
function renderCard(item) {
    const hist = WatchHistory.get(item.id, item.type);
    let badge = '';
    if (hist && hist.season) badge = `<span class="card-resume-badge">S${hist.season}E${hist.episode}</span>`;
    else if (hist) badge = `<span class="card-resume-badge">Watched</span>`;
    let progress = '';
    if (hist && hist.position > 0 && hist.duration > 0) {
        const pct = Math.min(100, (hist.position / hist.duration) * 100);
        if (pct > 1 && pct < 97) progress = `<div class="card-progress"><div class="card-progress-fill" style="width:${pct}%"></div></div>`;
    }
    return `
    <div class="card" onclick="App.openDetail(${item.id},'${item.type}')">
        <div class="card-poster">
            ${posterHTML(item)}
            ${item.rating >= 7.5 ? '<span class="card-quality">HD</span>' : ''}
            ${badge}
            ${progress}
            <div class="card-play-icon">${playSVG(18)}</div>
            <div class="card-hover-overlay">
                <span class="card-hover-title">${esc(item.title)}</span>
                <span class="card-hover-meta">
                    ${item.rating ? `<span class="card-hover-rating">${starSVG()} ${item.rating}</span>` : ''}
                    ${item.year || ''}
                </span>
            </div>
        </div>
    </div>`;
}

function renderRow(title, items, link = '') {
    if (!items.length) return '';
    const id = 'row-' + title.replace(/\W+/g, '-').toLowerCase();
    return `
    <div class="section fade-in">
        <div class="section-header">
            <h2 class="section-title">${esc(title)}</h2>
            ${link ? `<a href="#" class="section-more" data-navigate="${link}">See all</a>` : ''}
        </div>
        <div class="row-container">
            <div class="row-arrow left" onclick="scrollRow('${id}',-1)">${arrowSVG('left')}</div>
            <div class="row" id="${id}">${items.map(renderCard).join('')}</div>
            <div class="row-arrow right" onclick="scrollRow('${id}',1)">${arrowSVG('right')}</div>
        </div>
    </div>`;
}

function renderHero(item) {
    if (!item) return '';
    const bg = item.backdrop ? `background-image:url('${esc(item.backdrop)}')` : 'background:linear-gradient(135deg,#0f3460,#1a1a2e)';
    return `
    <div class="hero" style="${bg}">
        <div class="hero-content fade-in">
            <div class="hero-badge">${item.type === 'tv' ? 'Series' : 'Movie'}</div>
            <h1 class="hero-title">${esc(item.title)}</h1>
            <div class="hero-meta">
                ${item.rating ? `<span class="hero-rating">${starSVG()} ${item.rating}</span>` : ''}
                ${item.year ? `<span class="hero-dot">&middot;</span><span>${item.year}</span>` : ''}
                ${item.runtime ? `<span class="hero-dot">&middot;</span><span>${item.runtime} min</span>` : ''}
                ${item.seasons ? `<span class="hero-dot">&middot;</span><span>${item.seasons} Season${item.seasons>1?'s':''}</span>` : ''}
            </div>
            <p class="hero-desc">${esc(item.desc)}</p>
            <div class="hero-actions">
                <button class="btn btn-primary" onclick="App.openPlayer(${item.id},'${item.type}')">${playSVG(16)} Watch Now</button>
                <button class="btn btn-ghost" onclick="App.openDetail(${item.id},'${item.type}')">More Info</button>
            </div>
        </div>
    </div>`;
}

function renderGrid(items) {
    if (!items.length) return '<div class="empty-state"><div class="empty-state-icon">:/</div><h3>Nothing found</h3><p>Try a different search or genre.</p></div>';
    return `<div class="grid">${items.map(renderCard).join('')}</div>`;
}

function renderGenreBar(genres, active = '') {
    return `<div class="genre-bar"><button class="genre-pill ${!active?'active':''}" onclick="App.filterGenre('')">All</button>${genres.map(g => `<button class="genre-pill ${String(g.id)===active?'active':''}" onclick="App.filterGenre('${g.id}')">${esc(g.name)}</button>`).join('')}</div>`;
}

function scrollRow(id, dir) {
    const el = document.getElementById(id);
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
}

// ------------------------------------------------------------------
// RENDER: DETAIL MODAL (with season/episode picker for TV)
// ------------------------------------------------------------------
function renderDetailContent(item) {
    const bg = item.backdrop ? `background-image:url('${esc(item.backdrop)}')` : 'background:linear-gradient(135deg,#0f3460,#1a1a2e)';
    let castHTML = '';
    if (item.cast?.length) {
        castHTML = `<h3 class="detail-section-title">Cast</h3><div class="detail-cast-row">${item.cast.map(c => `
            <div class="cast-item"><div class="cast-avatar">${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}">` : ''}</div><div class="cast-name">${esc(c.name)}</div></div>
        `).join('')}</div>`;
    }

    let seasonsHTML = '';
    if (item.type === 'tv' && item.seasonsData?.length) {
        const realSeasons = item.seasonsData.filter(s => s.season_number > 0);
        if (realSeasons.length) {
            const progress = WatchHistory.get(item.id, 'tv');
            const defaultSeason = progress?.season || realSeasons[0].season_number;
            seasonsHTML = `
            <div class="seasons-section">
                <h3 class="detail-section-title">Seasons & Episodes</h3>
                <div class="season-select-wrap">
                    <select class="season-select" id="seasonSelect" onchange="App.loadEpisodes(${item.id}, this.value)">
                        ${realSeasons.map(s => `<option value="${s.season_number}" ${s.season_number === defaultSeason ? 'selected' : ''}>Season ${s.season_number} (${s.episode_count} ep)</option>`).join('')}
                    </select>
                </div>
                <div class="episodes-list" id="episodesList"><div class="episodes-loading">Loading episodes...</div></div>
            </div>`;
        }
    }

    return `
    <div class="detail-backdrop" style="${bg}"></div>
    <div class="detail-body">
        <div class="detail-top">
            <div class="detail-poster-wrap"><div class="detail-poster">${posterHTML(item)}</div></div>
            <div class="detail-info">
                <h2 class="detail-title">${esc(item.title)}</h2>
                ${item.tagline ? `<p style="color:var(--text-muted);font-size:0.82rem;font-style:italic;margin-bottom:8px">${esc(item.tagline)}</p>` : ''}
                <div class="detail-meta">
                    ${item.rating ? `<span class="detail-rating">${starSVG()} ${item.rating}</span>` : ''}
                    ${item.year || ''}
                    ${item.runtime ? `<span class="hero-dot">&middot;</span> ${item.runtime} min` : ''}
                    ${item.seasons ? `<span class="hero-dot">&middot;</span> ${item.seasons} Season${item.seasons>1?'s':''}` : ''}
                    <span class="hero-dot">&middot;</span> ${item.type==='tv'?'Series':'Movie'}
                </div>
                <div class="detail-genres">${(item.genres||[]).map(g => `<span class="detail-genre-tag">${esc(g)}</span>`).join('')}</div>
            </div>
        </div>
        <div class="detail-actions">
            <button class="btn btn-primary" onclick="App.openPlayer(${item.id},'${item.type}')">${playSVG(16)} Watch Now</button>
            ${item.trailer ? `<button class="btn btn-ghost" onclick="App.playTrailer('${esc(item.trailer)}','${esc(item.title)}')">Trailer</button>` : ''}
        </div>
        <p class="detail-desc">${esc(item.desc)}</p>
        ${seasonsHTML}
        ${castHTML}
    </div>`;
}

function renderEpisodes(showId, episodes) {
    const hist = WatchHistory.get(showId, 'tv');
    return episodes.map(ep => {
        const still = ep.still_path ? CONFIG.IMG + 'w300' + ep.still_path : null;
        const watched = hist && hist.season === ep.season_number && hist.episode === ep.episode_number;
        return `
        <div class="episode-card ${watched ? 'watched' : ''}" onclick="App.openPlayer(${showId},'tv',${ep.season_number},${ep.episode_number})">
            <div class="episode-still">
                ${still ? `<img src="${esc(still)}" alt="">` : ''}
                <span class="episode-num">E${ep.episode_number}</span>
            </div>
            <div class="episode-info">
                <h4>${esc(ep.name || 'Episode ' + ep.episode_number)}</h4>
                <div class="ep-meta">${ep.runtime ? ep.runtime + ' min' : ''}${ep.air_date ? (ep.runtime ? ' &middot; ' : '') + ep.air_date : ''}</div>
                <p>${esc(ep.overview || '')}</p>
            </div>
            <div class="episode-play-btn">${playSVG(14)}</div>
        </div>`;
    }).join('');
}

// ------------------------------------------------------------------
// APP
// ------------------------------------------------------------------
const App = {
    async init() {
        this.setupButtonGlow();
        this.setupAuth();
        if (!Auth.loggedIn()) return;
        this.showApp();
        this.setupNav();
        this.setupSearch();
        this.setupModals();
        CustomPlayer.init();
        await this.navigate('home');
    },

    // Cursor-following gradient sheen on buttons (delegated → works for dynamic buttons too)
    setupButtonGlow() {
        document.addEventListener('pointermove', e => {
            const btn = e.target.closest('.btn');
            if (!btn) return;
            const r = btn.getBoundingClientRect();
            btn.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
            btn.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
        }, { passive: true });
    },

    setupAuth() {
        const overlay = document.getElementById('authOverlay');

        if (Auth.loggedIn()) {
            overlay.classList.add('hidden');
            return;
        }

        // Tab switching
        const tabActivate = document.getElementById('tabActivate');
        const tabLogin = document.getElementById('tabLogin');
        const keyForm = document.getElementById('keyForm');
        const loginForm = document.getElementById('loginForm');

        tabActivate.addEventListener('click', () => {
            tabActivate.classList.add('active'); tabLogin.classList.remove('active');
            keyForm.style.display = 'flex'; loginForm.style.display = 'none';
        });
        tabLogin.addEventListener('click', () => {
            tabLogin.classList.add('active'); tabActivate.classList.remove('active');
            loginForm.style.display = 'flex'; keyForm.style.display = 'none';
        });

        const launchApp = () => {
            overlay.classList.add('hidden');
            this.showApp();
            this.setupNav(); this.setupSearch(); this.setupModals(); CustomPlayer.init();
            this.navigate('home');
        };

        // Activate form (new user)
        keyForm.addEventListener('submit', async e => {
            e.preventDefault();
            const displayName = document.getElementById('displayNameInput').value.trim();
            const key = document.getElementById('licenseKey').value.trim();
            if (!displayName || !key) return;
            const errorEl = document.getElementById('keyError');
            const btn = document.getElementById('keySubmitBtn');
            errorEl.textContent = '';
            btn.disabled = true; btn.textContent = 'Activating...';

            const err = await Auth.activate(key, displayName);
            if (err) { errorEl.textContent = err; btn.disabled = false; btn.textContent = 'Activate'; return; }
            launchApp();
        });

        // Login form (returning user — key only)
        loginForm.addEventListener('submit', async e => {
            e.preventDefault();
            const key = document.getElementById('loginPass').value.trim();
            if (!key) return;
            const errorEl = document.getElementById('loginError');
            const btn = document.getElementById('loginSubmitBtn');
            errorEl.textContent = '';
            btn.disabled = true; btn.textContent = 'Signing in...';

            await KEYAUTH.init();
            const result = await KEYAUTH.login(key, key);
            console.log('[KeyAuth login]', JSON.stringify(result));
            if (!result.success) { errorEl.textContent = result.message || 'Invalid key'; btn.disabled = false; btn.textContent = 'Sign In'; return; }

            const sub = result.info?.subscriptions?.[0];
            // Preserve their display name from any previous session on this device
            const existing = Auth.session();
            localStorage.setItem('hesp_session', JSON.stringify({
                id: key, key,
                displayName: existing?.displayName || 'Member',
                plan: sub?.subscription || 'Classic',
                expiry: sub?.expiry || null,
            }));
            launchApp();
        });
    },

    showApp() {
        const s = Auth.session();
        if (s) {
            document.getElementById('userNameDisplay').textContent = s.displayName || s.username;
            const badge = document.getElementById('planBadge');
            badge.textContent = s.plan;
            if (s.plan.toLowerCase().includes('ultimate')) badge.classList.add('ultimate');
            document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());
        }
    },

    setupNav() {
        window.addEventListener('scroll', () => {
            document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 30);
        });
        document.querySelectorAll('[data-navigate]').forEach(el => {
            el.addEventListener('click', e => { e.preventDefault(); this.navigate(el.dataset.navigate); });
        });
    },

    setupSearch() {
        const toggle = document.getElementById('searchToggle');
        const wrapper = document.getElementById('searchWrapper');
        const input = document.getElementById('searchInput');
        const dropdown = document.getElementById('searchDropdown');

        toggle.addEventListener('click', () => {
            wrapper.classList.toggle('open');
            if (wrapper.classList.contains('open')) setTimeout(() => input.focus(), 350);
            else { input.value = ''; dropdown.classList.remove('visible'); }
        });

        const doSearch = debounce(async q => {
            if (q.length < 2) { dropdown.classList.remove('visible'); return; }
            try {
                const data = await TMDB.searchMulti(q, 1);
                const results = data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 8).map(mapItem);
                if (!results.length) { dropdown.innerHTML = '<div class="search-empty">No results</div>'; }
                else {
                    dropdown.innerHTML = results.map(item => `
                        <div class="search-result-item" onclick="App.openDetail(${item.id},'${item.type}')">
                            <div class="search-result-poster">${posterHTML(item)}</div>
                            <div class="search-result-info"><h4>${esc(item.title)}</h4><span>${item.year || ''}${item.rating ? ' &middot; '+item.rating : ''}</span></div>
                            <span class="search-result-type">${item.type==='tv'?'Series':'Movie'}</span>
                        </div>`).join('');
                }
                dropdown.classList.add('visible');
            } catch(e) { console.error(e); }
        }, 300);

        input.addEventListener('input', () => doSearch(input.value.trim()));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && input.value.trim().length >= 2) {
                state.searchQuery = input.value.trim();
                dropdown.classList.remove('visible');
                wrapper.classList.remove('open');
                this.navigate('search');
                input.value = '';
            }
        });
        document.addEventListener('click', e => { if (!wrapper.contains(e.target)) dropdown.classList.remove('visible'); });
    },

    setupModals() {
        document.getElementById('detailClose').addEventListener('click', () => this.closeDetail());
        document.getElementById('detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') this.closeDetail(); });
        document.getElementById('playerClose').addEventListener('click', () => this.closePlayer());
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (document.getElementById('playerOverlay').classList.contains('active')) this.closePlayer();
                else this.closeDetail();
            }
        });
    },

    async navigate(page) {
        state.page = page;
        const app = document.getElementById('app');
        document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.navigate === page));
        document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.toggle('active', el.dataset.navigate === page));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.closeDetail();

        switch (page) {
            case 'home': await this.renderHome(app); break;
            case 'movies': await this.renderMovies(app); break;
            case 'series': await this.renderSeries(app); break;
            case 'search': await this.renderSearch(app); break;
        }

        app.querySelectorAll('[data-navigate]').forEach(a => {
            a.addEventListener('click', e => { e.preventDefault(); this.navigate(a.dataset.navigate); });
        });
    },

    // HOME
    async renderHome(el) {
        el.innerHTML = '<div style="height:80vh" class="skeleton"></div>';
        try {
            const [tRes, pRes, trRes, ptRes, ttRes] = await Promise.all([
                TMDB.trending(), TMDB.popularMovies(1), TMDB.topMovies(1), TMDB.popularTV(1), TMDB.topTV(1),
            ]);
            const trending = tRes.results.filter(r => r.media_type==='movie'||r.media_type==='tv').map(mapItem);
            const popular = pRes.results.map(r => mapItem({...r, media_type:'movie'}));
            const topRated = trRes.results.map(r => mapItem({...r, media_type:'movie'}));
            const popularTV = ptRes.results.map(r => mapItem({...r, media_type:'tv'}));
            const topTV = ttRes.results.map(r => mapItem({...r, media_type:'tv'}));

            state.allItems = [...trending, ...popular, ...topRated, ...popularTV, ...topTV];

            const continueWatching = WatchHistory.getAll().map(h => {
                const found = state.allItems.find(i => i.id === h.id && i.type === h.type);
                return found || { ...h, rating: 0, year: '', desc: '', genres: [] };
            }).slice(0, 10);

            let html = renderHero(trending[0]) + '<div style="padding-top:36px">';
            if (continueWatching.length) html += renderRow('Continue Watching', continueWatching);
            html += renderRow('Trending Now', trending.slice(0, 15));
            html += renderRow('Popular Movies', popular.slice(0, 15), 'movies');
            html += renderRow('Top Rated Movies', topRated.slice(0, 15), 'movies');
            html += renderRow('Popular Series', popularTV.slice(0, 15), 'series');
            html += renderRow('Top Rated Series', topTV.slice(0, 15), 'series');
            html += '</div>';
            el.innerHTML = html;
        } catch(e) {
            console.error(e);
            el.innerHTML = '<div class="empty-state" style="padding-top:200px"><h3>Could not load content</h3><p>Check your TMDB API key.</p></div>';
        }
    },

    // MOVIES
    async renderMovies(el) {
        if (!state.movieGenres.length) { try { state.movieGenres = (await TMDB.movieGenres()).genres; } catch(e) {} }
        el.innerHTML = `<div class="page-section"><h1 class="page-title">Movies</h1><p class="page-subtitle">Browse our full collection.</p>${renderGenreBar(state.movieGenres, state.activeGenre)}<div id="gridContainer"><div class="skeleton" style="height:400px"></div></div><div class="load-more-wrap" id="loadMoreWrap"></div></div>`;
        state.moviesPage = 1; state.moviesCache = []; state.hasMoreMovies = true;
        await this.loadMovies();
    },
    async loadMovies() {
        try {
            const data = await TMDB.discoverMovies(state.moviesPage, state.activeGenre);
            const items = data.results.map(r => mapItem({...r, media_type:'movie'}));
            state.moviesCache = state.moviesPage === 1 ? items : [...state.moviesCache, ...items];
            state.hasMoreMovies = state.moviesPage < data.total_pages;
            state.allItems = [...state.allItems, ...items];
            document.getElementById('gridContainer').innerHTML = renderGrid(state.moviesCache);
            document.getElementById('loadMoreWrap').innerHTML = state.hasMoreMovies ? '<button class="btn-load-more" onclick="App.loadMoreMovies()">Load More</button>' : '';
        } catch(e) { console.error(e); }
    },
    async loadMoreMovies() { state.moviesPage++; await this.loadMovies(); },

    // SERIES
    async renderSeries(el) {
        if (!state.tvGenres.length) { try { state.tvGenres = (await TMDB.tvGenres()).genres; } catch(e) {} }
        el.innerHTML = `<div class="page-section"><h1 class="page-title">Series</h1><p class="page-subtitle">Binge-worthy shows waiting for you.</p>${renderGenreBar(state.tvGenres, state.activeGenre)}<div id="gridContainer"><div class="skeleton" style="height:400px"></div></div><div class="load-more-wrap" id="loadMoreWrap"></div></div>`;
        state.seriesPage = 1; state.seriesCache = []; state.hasMoreSeries = true;
        await this.loadSeries();
    },
    async loadSeries() {
        try {
            const data = await TMDB.discoverTV(state.seriesPage, state.activeGenre);
            const items = data.results.map(r => mapItem({...r, media_type:'tv'}));
            state.seriesCache = state.seriesPage === 1 ? items : [...state.seriesCache, ...items];
            state.hasMoreSeries = state.seriesPage < data.total_pages;
            state.allItems = [...state.allItems, ...items];
            document.getElementById('gridContainer').innerHTML = renderGrid(state.seriesCache);
            document.getElementById('loadMoreWrap').innerHTML = state.hasMoreSeries ? '<button class="btn-load-more" onclick="App.loadMoreSeries()">Load More</button>' : '';
        } catch(e) { console.error(e); }
    },
    async loadMoreSeries() { state.seriesPage++; await this.loadSeries(); },

    // SEARCH
    async renderSearch(el) {
        el.innerHTML = `<div class="page-section"><h1 class="page-title">Search</h1><div class="search-page-input-wrap"><span class="search-page-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input type="text" class="search-page-input" id="searchPageInput" placeholder="Search movies & series..." value="${esc(state.searchQuery||'')}" autocomplete="off"></div><div id="searchGridContainer"></div></div>`;
        const input = document.getElementById('searchPageInput');
        input.focus();
        const doSearch = debounce(async q => {
            if (q.length < 2) { document.getElementById('searchGridContainer').innerHTML = '<div class="empty-state"><p>Type at least 2 characters.</p></div>'; return; }
            try {
                const data = await TMDB.searchMulti(q, 1);
                const results = data.results.filter(r => r.media_type==='movie'||r.media_type==='tv').map(mapItem);
                state.allItems = [...state.allItems, ...results];
                document.getElementById('searchGridContainer').innerHTML = renderGrid(results);
            } catch(e) { console.error(e); }
        }, 300);
        input.addEventListener('input', () => { state.searchQuery = input.value.trim(); doSearch(state.searchQuery); });
        if (state.searchQuery?.length >= 2) doSearch(state.searchQuery);
    },

    filterGenre(id) {
        state.activeGenre = id;
        const app = document.getElementById('app');
        if (state.page === 'movies') this.renderMovies(app);
        else if (state.page === 'series') this.renderSeries(app);
    },

    // DETAIL
    async openDetail(id, type) {
        try {
            const raw = type === 'tv' ? await TMDB.tvDetail(id) : await TMDB.movieDetail(id);
            const item = mapDetail(raw, type);
            document.getElementById('detailContent').innerHTML = renderDetailContent(item);
            document.getElementById('detailModal').classList.add('active');
            document.body.style.overflow = 'hidden';
            if (type === 'tv' && item.seasonsData?.length) {
                const firstReal = item.seasonsData.find(s => s.season_number > 0);
                const progress = WatchHistory.get(id, 'tv');
                this.loadEpisodes(id, progress?.season || firstReal?.season_number || 1);
            }
        } catch(e) { console.error(e); }
    },

    async loadEpisodes(showId, seasonNum) {
        const list = document.getElementById('episodesList');
        if (!list) return;
        list.innerHTML = '<div class="episodes-loading">Loading...</div>';
        try {
            const data = await TMDB.tvSeason(showId, seasonNum);
            list.innerHTML = renderEpisodes(showId, data.episodes || []);
        } catch(e) { list.innerHTML = '<div class="episodes-loading">Could not load episodes</div>'; }
    },

    closeDetail() {
        document.getElementById('detailModal').classList.remove('active');
        document.body.style.overflow = '';
    },

    // PLAYER
    openPlayer(id, type, season, episode) {
        this.closeDetail();
        const overlay = document.getElementById('playerOverlay');
        const cached = state.allItems.find(i => i.id === id);

        if (type === 'tv' && !season) {
            const hist = WatchHistory.get(id, 'tv');
            season = hist?.season || 1;
            episode = hist?.episode || 1;
        }

        let titleText = cached?.title || '';
        if (type === 'tv') titleText += ` · S${season}E${episode}`;
        document.getElementById('playerTitle').textContent = titleText;

        WatchHistory.save({
            id, type,
            title: cached?.title || titleText,
            poster: cached?.poster || null,
            season: season || null,
            episode: episode || null,
        });

        // Remember what's playing (for resume + auto-next)
        CustomPlayer.current = { id, type, season: season || null, episode: episode || null, title: cached?.title || titleText };
        CustomPlayer.resumeAt = WatchHistory.get(id, type)?.position || 0;

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        const load = () => CustomPlayer.load(id, type, season, episode, load);
        load();
    },

    playTrailer(ytId, title) {
        this.closeDetail();
        // Trailers still use YouTube embed — that's fine, it's not our content
        const overlay = document.getElementById('playerOverlay');
        document.getElementById('playerTitle').textContent = title + ' — Trailer';
        CustomPlayer.destroy();

        const video = document.getElementById('playerVideo');
        video.style.display = 'none';

        // Inject a temporary iframe for the trailer
        let frame = document.getElementById('trailerFrame');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'trailerFrame';
            frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;z-index:5;';
            frame.allow = 'autoplay; encrypted-media; fullscreen';
            frame.allowFullscreen = true;
            overlay.appendChild(frame);
        }
        frame.src = `https://www.youtube.com/embed/${esc(ytId)}?autoplay=1&rel=0`;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closePlayer() {
        CustomPlayer.destroy();
        document.getElementById('playerOverlay').classList.remove('active');
        document.body.style.overflow = '';

        // Clean up video element visibility & trailer frame
        const video = document.getElementById('playerVideo');
        if (video) video.style.display = '';
        const frame = document.getElementById('trailerFrame');
        if (frame) { frame.src = ''; frame.remove(); }
    },
};

// ------------------------------------------------------------------
// INIT
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => App.init());
