/**
 * game.js — Core game engine for geofill
 *
 * Dependencies (loaded before this script via CDN + file):
 *   - d3 v7          → window.d3
 *   - topojson-client v3 → window.topojson
 *   - fuzzy.js       → window.normalize, window.findExactMatch, window.findNearMiss
 *   - leaderboard.js → window.Leaderboard
 */

(async function () {
  'use strict';

  // ── 1. URL Parameters ──────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const mapId = params.get('map') || 'europe';
  const mode  = params.get('mode') || 'classic';

  // ── 2. DOM References ──────────────────────────────────────────
  const svgEl          = document.getElementById('map-svg');
  const mapLoading     = document.getElementById('map-loading');
  const mapError       = document.getElementById('map-error');
  const inputArea      = document.getElementById('input-area');
  const choiceArea     = document.getElementById('choice-area');
  const countryInput   = document.getElementById('country-input');
  const hintText       = document.getElementById('hint-text');
  const feedbackText   = document.getElementById('feedback-text');
  const timerDisplay   = document.getElementById('timer-display');
  const foundCountEl   = document.getElementById('found-count');
  const totalCountEl   = document.getElementById('total-count');
  const pbIndicator    = document.getElementById('pb-indicator');
  const mapLabelEl     = document.getElementById('game-map-label');
  const modeBadgeEl    = document.getElementById('game-mode-badge');
  const choiceButtons  = Array.from(document.querySelectorAll('.choice-btn'));
  const modal          = document.getElementById('completion-modal');
  const modalBackdrop  = document.getElementById('modal-backdrop');
  const modalTitle     = document.getElementById('modal-title');
  const modalTime      = document.getElementById('modal-time');
  const modalScore     = document.getElementById('modal-score');
  const modalPbBadge   = document.getElementById('modal-pb-badge');
  const playerNameInput= document.getElementById('player-name-input');
  const submitBtn      = document.getElementById('submit-score-btn');
  const submitError    = document.getElementById('submit-error');
  const playAgainBtn   = document.getElementById('play-again-btn');
  const changeMapBtn   = document.getElementById('change-map-btn');
  const lbContainer    = document.getElementById('modal-leaderboard-container');

  // ── 3. Game State ──────────────────────────────────────────────
  const state = {
    mapConfig:     null,
    mode:          mode,
    found:         new Set(),
    remaining:     new Set(),
    startTime:     null,
    timerInterval: null,
    isComplete:    false,
    currentChoice: null,   // for Multiple Choice mode
    elapsedSeconds: 0
  };

  // ── 4. Helpers ─────────────────────────────────────────────────
  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function getCountryById(id) {
    return state.mapConfig.countries.find(c => c.id === id);
  }

  function getRemainingCountries() {
    return state.mapConfig.countries.filter(c => state.remaining.has(c.id));
  }

  function pbKey() {
    return `geofill_pb_${state.mapConfig.id}_${state.mode}`;
  }

  // ── 5. Load Map Config ─────────────────────────────────────────
  let mapConfig;
  try {
    const resp = await fetch(`maps/${mapId}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    mapConfig = await resp.json();
  } catch (e) {
    showError(`Could not load map "${mapId}": ${e.message}`);
    return;
  }
  state.mapConfig = mapConfig;

  // Init remaining set
  mapConfig.countries.forEach(c => state.remaining.add(c.id));

  // Update UI labels
  if (mapLabelEl) mapLabelEl.textContent = mapConfig.label;
  if (modeBadgeEl) modeBadgeEl.textContent = modeName(mode);
  if (totalCountEl) totalCountEl.textContent = mapConfig.countries.length;
  if (foundCountEl) foundCountEl.textContent = 0;
  if (timerDisplay) timerDisplay.textContent = '00:00';

  // Show personal best if Timer mode
  if (mode === 'timer' && pbIndicator) {
    const pb = localStorage.getItem(pbKey());
    if (pb) {
      pbIndicator.innerHTML = `PB <span class="pb-value">${formatTime(parseInt(pb, 10))}</span>`;
      pbIndicator.style.display = '';
    }
  }

  // ── 6. D3 Map Rendering ────────────────────────────────────────
  const d3 = window.d3;
  const topojson = window.topojson;

  const svg = d3.select(svgEl);
  const g = svg.append('g').attr('class', 'map-group');

  // Projection
  const proj = makeProjection(mapConfig.projectionConfig, svgEl.clientWidth, svgEl.clientHeight);
  const pathGen = d3.geoPath().projection(proj);

  // Zoom + Pan
  const zoom = d3.zoom()
    .scaleExtent([0.8, 12])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);
  // Double-click to reset zoom
  svg.on('dblclick.zoom', null);
  svg.on('dblclick', () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  // Fetch TopoJSON
  let topoData;
  try {
    topoData = await d3.json(mapConfig.topoJsonUrl);
  } catch (e) {
    showError(`Could not load map data: ${e.message}`);
    return;
  }

  // Extract and filter features
  const objKey = mapConfig.topoJsonObjectKey;
  const allFeatures = topojson.feature(topoData, topoData.objects[objKey]).features;

  // Build lookup: featureId → country config
  // Europe uses isoNumeric, USA uses fips — both stored as strings matching feature.id
  const featureIdField = mapConfig.id === 'usa' ? 'fips' : 'isoNumeric';
  const countryByFeatureId = new Map();
  mapConfig.countries.forEach(c => {
    if (!c.isMarker && c[featureIdField]) {
      countryByFeatureId.set(String(c[featureIdField]), c);
    }
  });

  const filteredFeatures = allFeatures.filter(f => {
    const fid = String(f.id);
    return countryByFeatureId.has(fid);
  });

  // Log any countries without a matching feature (for debugging)
  const foundFeatureIds = new Set(filteredFeatures.map(f => String(f.id)));
  mapConfig.countries.forEach(c => {
    if (!c.isMarker && c[featureIdField] && !foundFeatureIds.has(String(c[featureIdField]))) {
      console.warn(`geofill: no TopoJSON feature found for ${c.name} (${featureIdField}: ${c[featureIdField]})`);
    }
  });

  // Render country paths
  g.selectAll('path.country')
    .data(filteredFeatures)
    .join('path')
    .attr('class', 'country')
    .attr('d', d => pathGen(d) || '')
    .attr('data-country-id', d => {
      const c = countryByFeatureId.get(String(d.id));
      return c ? c.id : null;
    });

  // Render labels at centroid of each path feature
  g.selectAll('text.country-label')
    .data(filteredFeatures)
    .join('text')
    .attr('class', 'country-label')
    .attr('data-label-id', d => {
      const c = countryByFeatureId.get(String(d.id));
      return c ? c.id : null;
    })
    .attr('x', d => pathGen.centroid(d)[0])
    .attr('y', d => pathGen.centroid(d)[1])
    .text(d => {
      const c = countryByFeatureId.get(String(d.id));
      return c ? c.name : '';
    });

  // Render marker circles (microstates, Kosovo)
  const markerCountries = mapConfig.countries.filter(c => c.isMarker);
  g.selectAll('circle.country')
    .data(markerCountries)
    .join('circle')
    .attr('class', 'country')
    .attr('data-country-id', d => d.id)
    .attr('r', 5)
    .attr('cx', d => {
      const pt = proj([d.lng, d.lat]);
      return pt ? pt[0] : -999;
    })
    .attr('cy', d => {
      const pt = proj([d.lng, d.lat]);
      return pt ? pt[1] : -999;
    })
    .append('title')
    .text(d => d.name);

  // Render labels for marker countries (offset above the circle)
  g.selectAll('text.marker-label')
    .data(markerCountries)
    .join('text')
    .attr('class', 'country-label marker-label')
    .attr('data-label-id', d => d.id)
    .attr('x', d => {
      const pt = proj([d.lng, d.lat]);
      return pt ? pt[0] : -999;
    })
    .attr('y', d => {
      const pt = proj([d.lng, d.lat]);
      return pt ? pt[1] - 10 : -999;
    })
    .text(d => d.name);

  // Hide loading overlay
  if (mapLoading) mapLoading.style.display = 'none';

  // ── 7. Resize Handler ──────────────────────────────────────────
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const newProj = makeProjection(mapConfig.projectionConfig, svgEl.clientWidth, svgEl.clientHeight);
      const newPathGen = d3.geoPath().projection(newProj);

      g.selectAll('path.country')
        .attr('d', d => newPathGen(d) || '');

      g.selectAll('circle.country')
        .attr('cx', d => { const pt = newProj([d.lng, d.lat]); return pt ? pt[0] : -999; })
        .attr('cy', d => { const pt = newProj([d.lng, d.lat]); return pt ? pt[1] : -999; });

      g.selectAll('text.country-label:not(.marker-label)')
        .attr('x', d => newPathGen.centroid(d)[0])
        .attr('y', d => newPathGen.centroid(d)[1]);

      g.selectAll('text.marker-label')
        .attr('x', d => { const pt = newProj([d.lng, d.lat]); return pt ? pt[0] : -999; })
        .attr('y', d => { const pt = newProj([d.lng, d.lat]); return pt ? pt[1] - 10 : -999; });
    }, 200);
  });

  // ── 8. Mode Setup ──────────────────────────────────────────────
  if (mode === 'choice') {
    if (inputArea)  inputArea.style.display  = 'none';
    if (choiceArea) choiceArea.style.display = 'flex';
    // Auto-start timer for choice mode
    state.startTime = Date.now();
    startTimer();
    presentNextChoice();
  } else {
    if (inputArea)  inputArea.style.display  = 'flex';
    if (choiceArea) choiceArea.style.display = 'none';
    if (countryInput) {
      countryInput.addEventListener('input', handleInput);
      countryInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleEnter();
      });
      countryInput.focus();
    }
  }

  // ── 9. Input Handler (Classic / Timer) ─────────────────────────
  let hintTimeout = null;
  let feedbackTimeout = null;

  function handleInput(e) {
    if (state.isComplete) return;
    const raw = countryInput.value;
    const normInput = window.normalize(raw);

    // Start timer on first non-empty input
    if (!state.startTime && normInput.length > 0) {
      state.startTime = Date.now();
      startTimer();
    }

    // Clear hint whenever the player keeps typing
    clearHint();
  }

  function handleEnter() {
    if (state.isComplete) return;
    const raw = countryInput.value;
    const normInput = window.normalize(raw);

    if (normInput.length === 0) return;

    // Exact / alias match
    const remainingArr = getRemainingCountries();
    const match = window.findExactMatch(raw, remainingArr);
    if (match) {
      markFound(match.id);
      countryInput.value = '';
      clearHint();
      flashInput('correct');
      showFeedback(`✓ ${match.name}`, 'correct');
      return;
    }

    // Already found?
    const allCountries = state.mapConfig ? state.mapConfig.countries : [];
    const alreadyFound = window.findExactMatch(raw, allCountries.filter(c => state.found.has(c.id)));
    if (alreadyFound) {
      flashInput('already');
      showFeedback(`Already found ${alreadyFound.name}`, 'already');
      return;
    }

    // Near-miss fuzzy hint — only on Enter, max distance 2
    const nearMiss = window.findNearMiss(raw, remainingArr, 2);
    if (nearMiss) {
      showHint(`Did you mean ${nearMiss.name}?`);
      flashInput('wrong');
    } else {
      flashInput('wrong');
    }
  }

  // ── 10. markFound ──────────────────────────────────────────────
  function markFound(countryId) {
    state.found.add(countryId);
    state.remaining.delete(countryId);

    // Update SVG element
    const el = d3.select(`[data-country-id="${countryId}"]`);
    el.classed('found', true).classed('hint', false);

    // Show label
    d3.select(`[data-label-id="${countryId}"]`).classed('visible', true);

    // Brief flash-correct on the path
    el.classed('flash-correct', true);
    setTimeout(() => el.classed('flash-correct', false), 500);

    // Update counters
    if (foundCountEl) foundCountEl.textContent = state.found.size;

    if (state.remaining.size === 0) {
      // Small delay so the last fill animation plays
      setTimeout(triggerCompletion, 350);
    }
  }

  // ── 11. Timer ──────────────────────────────────────────────────
  function startTimer() {
    if (state.timerInterval) return;
    state.timerInterval = setInterval(() => {
      state.elapsedSeconds = Math.floor((Date.now() - state.startTime) / 1000);
      if (timerDisplay) timerDisplay.textContent = formatTime(state.elapsedSeconds);
    }, 500);
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.elapsedSeconds = Math.floor((Date.now() - state.startTime) / 1000);
    if (timerDisplay) timerDisplay.textContent = formatTime(state.elapsedSeconds);
  }

  // ── 12. Multiple Choice Mode ───────────────────────────────────
  function presentNextChoice() {
    if (state.isComplete || state.remaining.size === 0) return;

    // Clear previous hint glow
    d3.selectAll('.country').classed('hint', false);

    // Pick a random remaining country
    const remainingArr = [...state.remaining];
    const targetId = remainingArr[Math.floor(Math.random() * remainingArr.length)];
    state.currentChoice = targetId;

    // Highlight on map
    d3.select(`[data-country-id="${targetId}"]`).classed('hint', true);

    // Build 4 options (1 correct + 3 wrong)
    const wrongPool = remainingArr.filter(id => id !== targetId);
    // If not enough remaining, pull from found
    if (wrongPool.length < 3) {
      const found = [...state.found];
      shuffle(found);
      wrongPool.push(...found);
    }
    shuffle(wrongPool);

    const options = [targetId, ...wrongPool.slice(0, 3)];
    shuffle(options);

    choiceButtons.forEach((btn, i) => {
      const country = getCountryById(options[i]);
      btn.textContent = country ? country.name : '?';
      btn.dataset.countryId = options[i];
      btn.disabled = false;
      btn.className = 'choice-btn';
      btn.onclick = () => handleChoiceClick(options[i], targetId);
    });
  }

  function handleChoiceClick(chosen, target) {
    const btn = document.querySelector(`.choice-btn[data-country-id="${chosen}"]`);
    if (chosen === target) {
      if (btn) {
        btn.classList.add('flash-correct');
        setTimeout(() => btn.classList.remove('flash-correct'), 500);
      }
      markFound(target);
      setTimeout(presentNextChoice, 600);
    } else {
      if (btn) {
        btn.classList.add('flash-wrong');
        setTimeout(() => btn.classList.remove('flash-wrong'), 500);
      }
      // Flash the map element too
      const el = d3.select(`[data-country-id="${chosen}"]`);
      el.classed('flash-wrong', true);
      setTimeout(() => el.classed('flash-wrong', false), 500);
    }
  }

  // ── 13. Completion ─────────────────────────────────────────────
  function triggerCompletion() {
    if (state.isComplete) return;
    state.isComplete = true;

    stopTimer();
    const elapsed = state.elapsedSeconds;

    // Remove hint glow
    d3.selectAll('.country').classed('hint', false);

    // Check personal best (classic + timer modes)
    let isNewPb = false;
    if (mode === 'classic' || mode === 'timer') {
      const prev = parseInt(localStorage.getItem(pbKey()), 10);
      if (!prev || elapsed < prev) {
        localStorage.setItem(pbKey(), elapsed);
        isNewPb = true;
      }
    }

    // Show completion modal
    showCompletionModal(elapsed, isNewPb);
  }

  function showCompletionModal(elapsed, isNewPb) {
    if (modalTitle) {
      modalTitle.textContent = state.found.size === state.mapConfig.countries.length
        ? 'Complete!'
        : `${state.found.size}/${state.mapConfig.countries.length} found`;
    }
    if (modalTime) modalTime.textContent = formatTime(elapsed);
    if (modalScore) modalScore.textContent = `${state.found.size} / ${state.mapConfig.countries.length}`;

    if (modalPbBadge) {
      if (isNewPb && (mode === 'classic' || mode === 'timer')) {
        modalPbBadge.textContent = '★ New Personal Best!';
        modalPbBadge.style.display = '';
      } else {
        modalPbBadge.style.display = 'none';
      }
    }

    // Load leaderboard
    window.Leaderboard.loadAndRenderLeaderboard(mapId, mode, lbContainer);

    if (modalBackdrop) modalBackdrop.classList.add('visible');

    // Play again
    if (playAgainBtn) {
      playAgainBtn.onclick = () => window.location.reload();
    }
    if (changeMapBtn) {
      changeMapBtn.onclick = () => { window.location.href = 'index.html'; };
    }

    // Submit score
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const name = (playerNameInput ? playerNameInput.value : '').trim();
        if (!name) {
          if (submitError) submitError.textContent = 'Please enter your name.';
          return;
        }
        if (submitError) submitError.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';

        try {
          await window.Leaderboard.submitScore({
            playerName: name,
            mapId: mapId,
            mode: mode,
            timeSeconds: elapsed,
            foundCount: state.found.size,
            totalCount: state.mapConfig.countries.length
          });
          submitBtn.textContent = 'Submitted ✓';
          // Refresh leaderboard
          window.Leaderboard.loadAndRenderLeaderboard(mapId, mode, lbContainer);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit to Leaderboard';
          if (submitError) submitError.textContent = 'Could not submit. Try again.';
        }
      };
    }
  }

  // ── 14. UI helpers ─────────────────────────────────────────────
  function showHint(msg) {
    if (!hintText) return;
    hintText.textContent = msg;
    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => { hintText.textContent = ''; }, 4000);
  }

  function clearHint() {
    if (hintText) hintText.textContent = '';
    clearTimeout(hintTimeout);
  }

  function showFeedback(msg, type) {
    if (!feedbackText) return;
    feedbackText.textContent = msg;
    feedbackText.className = type || '';
    clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => {
      feedbackText.textContent = '';
      feedbackText.className = '';
    }, 2000);
  }

  function flashInput(type) {
    if (!countryInput) return;
    countryInput.classList.add(`flash-${type}`);
    setTimeout(() => countryInput.classList.remove(`flash-${type}`), 400);
  }

  function showError(msg) {
    if (mapLoading) mapLoading.style.display = 'none';
    if (mapError) {
      mapError.classList.add('visible');
      const p = mapError.querySelector('.error-box p');
      if (p) p.textContent = msg;
    }
  }

  function modeName(m) {
    return { classic: 'Classic', timer: 'Timer Challenge', choice: 'Multiple Choice' }[m] || m;
  }

  // ── 15. Projection Factory ─────────────────────────────────────
  function makeProjection(cfg, width, height) {
    if (cfg.type === 'albersUsa') {
      return d3.geoAlbersUsa()
        .scale(cfg.scale || 1100)
        .translate([width / 2, height / 2]);
    }
    // Default: Mercator
    return d3.geoMercator()
      .center(cfg.center || [0, 0])
      .scale(cfg.scale || 150)
      .translate([width / 2, height / 2]);
  }

})();
