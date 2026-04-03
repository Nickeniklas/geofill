/**
 * leaderboard.js — Supabase read/write and table rendering for geofill
 * Depends on: supabase-js v2 (CDN), config.js (window.GEOFILL_CONFIG)
 */

(function () {
  let _client = null;
  let _available = false;

  function getClient() {
    if (_client) return _client;
    try {
      const cfg = window.GEOFILL_CONFIG;
      if (!cfg || cfg.supabaseUrl === 'PLACEHOLDER' || cfg.supabaseKey === 'PLACEHOLDER') {
        return null;
      }
      _client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      _available = true;
    } catch (e) {
      console.warn('Leaderboard: could not initialize Supabase client', e);
      _client = null;
    }
    return _client;
  }

  /**
   * Submit a score to the leaderboard.
   * @param {object} params
   * @param {string} params.playerName
   * @param {string} params.mapId
   * @param {string} params.mode  — 'classic' | 'timer' | 'choice'
   * @param {number} params.timeSeconds
   * @param {number} params.foundCount
   * @param {number} params.totalCount
   * @returns {Promise<void>}
   */
  async function submitScore({ playerName, mapId, mode, timeSeconds, foundCount, totalCount }) {
    const client = getClient();
    if (!client) throw new Error('Leaderboard not available');

    const { error } = await client.from('scores').insert([{
      player_name: playerName,
      map_id: mapId,
      mode: mode,
      time_seconds: timeSeconds,
      found_count: foundCount,
      total_count: totalCount
    }]);

    if (error) throw error;
  }

  /**
   * Fetch top scores for a given map + mode.
   * @param {string} mapId
   * @param {string} mode
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async function getTopScores(mapId, mode, limit) {
    limit = limit === undefined ? 10 : limit;
    const client = getClient();
    if (!client) throw new Error('Leaderboard not available');

    const { data, error } = await client
      .from('scores')
      .select('player_name, time_seconds, found_count, total_count, created_at')
      .eq('map_id', mapId)
      .eq('mode', mode)
      .order('time_seconds', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  /**
   * Render a leaderboard table into `container`.
   * Handles loading state, errors, and "unavailable" gracefully.
   * @param {Array|null} scores  — null means show "unavailable"
   * @param {HTMLElement} container
   */
  function renderLeaderboard(scores, container) {
    if (!container) return;

    if (!scores) {
      container.innerHTML = '<p class="lb-unavailable">Leaderboard unavailable — Supabase not configured.</p>';
      return;
    }

    if (scores.length === 0) {
      container.innerHTML = '<p class="lb-unavailable">No scores yet. Be the first!</p>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'lb-table';

    table.innerHTML = `
      <thead>
        <tr>
          <th class="lb-rank">#</th>
          <th>Player</th>
          <th class="lb-time">Time</th>
          <th>Score</th>
          <th class="lb-date">Date</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');
    scores.forEach((row, i) => {
      const tr = document.createElement('tr');
      const date = new Date(row.created_at);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
      tr.innerHTML = `
        <td class="lb-rank">${i + 1}</td>
        <td>${escapeHtml(row.player_name)}</td>
        <td class="lb-time">${formatTime(row.time_seconds)}</td>
        <td>${row.found_count}/${row.total_count}</td>
        <td class="lb-date">${dateStr}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
  }

  /**
   * Load and render leaderboard into container, handling all async states.
   * Shows a loading state while fetching.
   */
  async function loadAndRenderLeaderboard(mapId, mode, container) {
    if (!container) return;

    const client = getClient();
    if (!client) {
      renderLeaderboard(null, container);
      return;
    }

    container.innerHTML = '<p class="lb-unavailable">Loading…</p>';

    try {
      const scores = await getTopScores(mapId, mode);
      renderLeaderboard(scores, container);
    } catch (e) {
      console.warn('Leaderboard fetch error:', e);
      container.innerHTML = '<p class="lb-unavailable">Could not load leaderboard.</p>';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isAvailable() {
    return !!getClient();
  }

  // Expose globals
  window.Leaderboard = {
    submitScore,
    getTopScores,
    renderLeaderboard,
    loadAndRenderLeaderboard,
    isAvailable
  };
})();
