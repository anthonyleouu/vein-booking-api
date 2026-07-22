document.addEventListener("DOMContentLoaded", function () {

  const API_BASE = (window.SELENE_API_BASE || "https://vein-booking-api.vercel.app").replace(/\/+$/, "");
  const QUOTE_ENDPOINT = `${API_BASE}/api/quote`;
  const HOLD_ENDPOINT = `${API_BASE}/api/hold`;
  const CHECKOUT_ENDPOINT = `${API_BASE}/api/checkout`;

  // Initialize intl-tel-input on the chauffeur phone input (separate from transfer's)
  window.__chauffeurItiInstance = null;
  function initChauffeurPhone() {
    const chauffeurRoot = document.querySelector('.chauffeur_flow');
    const phoneInput = chauffeurRoot?.querySelector('#chauffeur_contact_phone');
    if (!phoneInput || !window.intlTelInput) return;
    if (window.__chauffeurItiInstance) return;
    window.__chauffeurItiInstance = window.intlTelInput(phoneInput, {
      initialCountry: "gr",
      separateDialCode: true,
      nationalMode: true,
      dropdownContainer: document.body
    });
  }

  // =========================
  // STATE
  // =========================
  function state() {
    window.__VEIN_BOOKING__ = window.__VEIN_BOOKING__ || {};
    window.__VEIN_BOOKING__.chauffeur = window.__VEIN_BOOKING__.chauffeur || {};
    return window.__VEIN_BOOKING__.chauffeur;
  }

  function setText(el, value, fallback = "-") {
    if (!el) return;
    const v = (value || "").toString().trim();
    el.textContent = v ? v : fallback;
  }

  function setTextAll(selector, value, fallback = "-") {
    const nodes = document.querySelectorAll(selector);
    const finalValue = value == null || String(value).trim() === "" ? fallback : String(value);
    nodes.forEach((el) => { el.textContent = finalValue; });
  }

  // =========================
  // FRIENDLY PLACE NAMES (reuse pattern from transfer)
  // =========================
  function normalizePlaceName(rawAddress) {
    if (rawAddress == null) return "";
    const s = String(rawAddress).trim();
    if (!s) return "";
    if (s.includes("Αττική Οδός")) return "Athens International Airport";
    const lower = s.toLowerCase();
    const patterns = [
      { match: ["airport", "eleftherios venizelos", "attiki odos, spata", "ath airport"], replace: "Athens International Airport" },
      { match: ["piraeus port", "piraeus cruise port", "great harbour piraeus"], replace: "Piraeus Port" },
      { match: ["rafina port", "port of rafina"], replace: "Rafina Port" },
      { match: ["lavrio port", "port of lavrio", "lavrion port"], replace: "Lavrio Port" }
    ];
    for (const p of patterns) {
      if (p.match.some(m => lower.includes(m))) return p.replace;
    }
    return s;
  }

  // =========================
  // STEP INDICATOR (scoped to chauffeur_steps_indicator)
  // =========================
  const stepsIndicator = document.querySelector(".chauffeur_steps_indicator");

  function chauffeurStepToUiStep(n) { return Math.max(1, Math.min(4, Number(n) - 1)); }
  function uiStepToChauffeurStep(n) { return Math.max(2, Math.min(5, Number(n) + 1)); }

  function updateStepIndicator(currentStep) {
    if (!stepsIndicator) return;
    const uiCurrent = chauffeurStepToUiStep(currentStep);
    const uiMax = Number(state().uiMaxReachedStep || uiCurrent || 1);

    stepsIndicator.querySelectorAll("[data-step-indicator]").forEach(el => {
      const n = Number(el.getAttribute("data-step-indicator"));
      el.classList.remove("is-completed", "is-active", "is-locked");
      if (n < uiCurrent) el.classList.add("is-completed");
      if (n === uiCurrent) el.classList.add("is-active");
      if (n > uiMax) el.classList.add("is-locked");
    });

    stepsIndicator.querySelectorAll("[data-step-line]").forEach(el => {
      const n = Number(el.getAttribute("data-step-line"));
      el.classList.remove("is-completed");
      if (uiCurrent >= n) el.classList.add("is-completed");
    });
  }

  // =========================
  // STEP SHOW/HIDE
  // =========================
  const step2 = document.querySelector('[data-step="chauffeur-2"]');
  const step3 = document.querySelector('[data-step="chauffeur-3"]');
  const step4 = document.querySelector('[data-step="chauffeur-4"]');
  const step5 = document.querySelector('[data-step="chauffeur-5"]');

  function showChauffeurStep(n) {
    const st = state();
    st.currentStep = n;
    setTextAll('[data-summary="service"]', 'Chauffeur');
    st.maxReachedStep = Math.max(Number(st.maxReachedStep || 2), n);
    const uiN = chauffeurStepToUiStep(n);
    st.uiMaxReachedStep = Math.max(Number(st.uiMaxReachedStep || 1), uiN);

    if (step2) step2.style.display = (n === 2) ? "block" : "none";
    if (step3) step3.style.display = (n === 3) ? "block" : "none";
    if (step4) step4.style.display = (n === 4) ? "block" : "none";
    if (step5) step5.style.display = (n === 5) ? "block" : "none";

    updateStepIndicator(n);

    if (n === 3) renderQuote(state().quote || {});
    if (n === 4) setTimeout(initChauffeurPhone, 50);
    if (n === 5) updateReviewSummary();
  }

  window.showChauffeurStep = showChauffeurStep;

  // Step indicator clicks
  if (stepsIndicator) {
    stepsIndicator.querySelectorAll("[data-step-indicator]").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", function () {
        const uiMax = Number(state().uiMaxReachedStep || 1);
        const uiTarget = Number(el.getAttribute("data-step-indicator"));
        if (uiTarget > uiMax) return;
        showChauffeurStep(uiStepToChauffeurStep(uiTarget));
      });
    });
  }

  // =========================
  // FLATPICKR (date/time)
  // =========================
  const dateInput = document.querySelector('input[data-picker="chauffeur-date"]');
  const timeInput = document.querySelector('input[data-picker="chauffeur-time"]');

  if (window.flatpickr) {
    flatpickr('input[data-picker="chauffeur-date"]', {
      dateFormat: "Y-m-d",
      minDate: "today",
      disableMobile: true
    });

    flatpickr('input[data-picker="chauffeur-time"]', {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      time_24hr: true,
      minuteIncrement: 15,
      disableMobile: true
    });
  }

  // Sync mobile time selects with the flatpickr time input
  const chauffeurRoot = document.querySelector('.chauffeur_flow');
  const hourSelect = chauffeurRoot?.querySelector('#chauffeur_time_hour');
  const minuteSelect = chauffeurRoot?.querySelector('#chauffeur_time_minute');
  const timeInputEl = chauffeurRoot?.querySelector('input[data-picker="chauffeur-time"]');

  function syncMobileTimeToFlatpickr() {
    if (!hourSelect || !minuteSelect || !timeInputEl) return;
    const h = hourSelect.value;
    const m = minuteSelect.value;
    if (h && m) {
      timeInputEl.value = `${h}:${m}`;
      // Fire change event so flatpickr's state updates
      timeInputEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  if (hourSelect) hourSelect.addEventListener("change", syncMobileTimeToFlatpickr);
  if (minuteSelect) minuteSelect.addEventListener("change", syncMobileTimeToFlatpickr);

  // =========================
  // GOOGLE PLACES (pickup only)
  // =========================
  const pickupInput = document.getElementById("chauffeur_pickup_location");

  function syncPickupCommitted() {
    if (!pickupInput) return;
    const v = pickupInput.dataset.address || pickupInput.value;
    const friendly = normalizePlaceName(v);
    if (friendly && friendly !== v) {
      pickupInput.value = friendly;
      pickupInput.dataset.address = friendly;
    }
  }

  if (pickupInput && window.google && google.maps && google.maps.places) {
    const options = {
      fields: ["place_id", "formatted_address", "geometry", "name"],
      componentRestrictions: { country: ["gr"] }
    };
    const pickupAC = new google.maps.places.Autocomplete(pickupInput, options);
    pickupAC.addListener("place_changed", () => {
      const place = pickupAC.getPlace();
      if (!place || !place.place_id) return;
      const display = place.formatted_address || place.name || pickupInput.value;
      pickupInput.dataset.placeId = place.place_id;
      pickupInput.dataset.address = display;
      syncPickupCommitted();
    });
  }

  if (pickupInput) pickupInput.addEventListener("blur", syncPickupCommitted);

  // =========================
  // COUNTERS (chauffeur.pax, chauffeur.luggage)
  // =========================
  const counterLimits = {
    "chauffeur.pax": { min: 1, max: 7 },
    "chauffeur.luggage": { min: 1, max: 8 }
  };

  function updateCounter(field, newValue) {
    const cfg = counterLimits[field];
    if (!cfg) return;
    const clamped = Math.max(cfg.min, Math.min(cfg.max, newValue));
    const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
    if (valueEl) valueEl.textContent = clamped;
  }

  document.querySelectorAll('[data-counter]').forEach(btn => {
    const field = btn.getAttribute("data-field");
    if (!counterLimits[field]) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      const type = this.getAttribute("data-counter");
      const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
      if (!valueEl) return;
      let current = parseInt(valueEl.textContent || "0", 10);
      if (type === "plus") current++;
      if (type === "minus") current--;
      updateCounter(field, current);
    });
  });

  // =========================
  // BUTTON LOADING
  // =========================
  function setBtnLoading(btn, isLoading, loadingText, idleText) {
    if (!btn) return;
    const label = btn.querySelector("[data-btn-label]");
    btn.disabled = isLoading;
    btn.style.opacity = isLoading ? "0.7" : "";
    if (label) label.textContent = isLoading ? loadingText : idleText;
    else btn.textContent = isLoading ? loadingText : idleText;
  }

  // =========================
  // STEP 2 -> QUOTE
  // =========================
  const nextStep2Btn = document.querySelector('[data-action="next-chauffeur-2"]');
  const durationSelect = document.getElementById("chauffeur_duration");
  let __quoteLoading = false;

  function validateStep2() {
    const pickupOk = !!(pickupInput && pickupInput.dataset.placeId);
    const dateOk = !!(dateInput && dateInput.value.trim());
    const timeOk = !!(timeInput && timeInput.value.trim());
    const durationOk = !!(durationSelect && durationSelect.value);
    return pickupOk && dateOk && timeOk && durationOk;
  }

  async function requestQuote() {
    const pickup_datetime_iso = new Date(
      `${dateInput.value.trim()}T${timeInput.value.trim()}:00`
    ).toISOString();

    const payload = {
      service_type: "CHAUFFEUR",
      pickup_datetime_iso,
      pickup_place_id: pickupInput.dataset.placeId,
      duration_hours: Number(durationSelect.value)
    };

    const res = await fetch(QUOTE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(async () => {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Quote request failed");
    });

    if (!res.ok || !json?.ok) throw new Error(json?.error || json?.message || "Quote failed");
    if (!json?.available) throw new Error(json?.message || "No vehicles available");
    if (!Number.isFinite(Number(json.price_total_eur))) throw new Error("Quote returned without a valid price");

    return json;
  }

  function renderQuote(quote) {
    const price = Number(quote?.price_total_eur);
    setTextAll(
      '[data-summary="chauffeur.total"]',
      Number.isFinite(price) ? `€${price}` : "-"
    );
    setTextAll(
      '[data-vehicle-price="chauffeur-vclass"]',
      Number.isFinite(price) ? `€${price}` : "-"
    );
  }

  if (nextStep2Btn) {
    nextStep2Btn.addEventListener("click", async function (e) {
      e.preventDefault();
      if (__quoteLoading) return;

      if (!validateStep2()) {
        alert("Please complete pickup, date, time, and duration.");
        return;
      }

      try {
        __quoteLoading = true;
        setBtnLoading(nextStep2Btn, true, "Calculating...", "Next");
        const quote = await requestQuote();
        state().quote = quote;
        renderQuote(quote);
        state().maxReachedStep = Math.max(Number(state().maxReachedStep || 2), 3);
        showChauffeurStep(3);
      } catch (err) {
        console.error("CHAUFFEUR QUOTE ERROR:", err);
        alert("Quote failed:\n" + (err?.message || String(err)));
      } finally {
        __quoteLoading = false;
        setBtnLoading(nextStep2Btn, false, "", "Next");
      }
    });
  }

  // =========================
  // STEP 3 -> VEHICLE
  // =========================
  const backStep3Btn = document.querySelector('[data-action="back-chauffeur-3"]');
  const nextStep3Btn = document.querySelector('[data-action="next-chauffeur-3"]');
  const selectVehicleBtn = document.querySelector('[data-action="select-chauffeur-vehicle"][data-vehicle="chauffeur-vclass"]');
  const summaryVehicleEl = document.querySelector('[data-summary="chauffeur.vehicle"]');
  const selectVehicleLabelEl = document.querySelector('[data-vehicle-select-label="chauffeur-vclass"]');

  function setNextEnabled(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "" : "0.5";
    btn.style.pointerEvents = enabled ? "" : "none";
  }

  function setVehicleSelectedUI(isSelected) {
    const labelText = isSelected ? "SELECTED" : "SELECT";
    if (selectVehicleLabelEl) selectVehicleLabelEl.textContent = labelText;
    else if (selectVehicleBtn) selectVehicleBtn.textContent = labelText;
    if (selectVehicleBtn) {
      selectVehicleBtn.classList.toggle("is-selected", !!isSelected);
      selectVehicleBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    }
  }

  setNextEnabled(nextStep3Btn, false);

  if (selectVehicleBtn) {
    selectVehicleBtn.addEventListener("click", function (e) {
      e.preventDefault();
      state().vehicle = "vclass";
      if (summaryVehicleEl) summaryVehicleEl.textContent = "Mercedes-Benz Vito";
      setVehicleSelectedUI(true);
      setNextEnabled(nextStep3Btn, true);
    });
  }

  if (backStep3Btn) {
    backStep3Btn.addEventListener("click", (e) => { e.preventDefault(); showChauffeurStep(2); });
  }

  if (nextStep3Btn) {
    nextStep3Btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (nextStep3Btn.disabled) return;
      state().maxReachedStep = Math.max(Number(state().maxReachedStep || 2), 4);
      showChauffeurStep(4);
    });
  }

  // =========================
  // STEP 4 -> CONTACT (shared contact inputs)
  // =========================
  const backStep4Btn = document.querySelector('[data-action="back-chauffeur-4"]');
  const nextStep4Btn = document.querySelector('[data-action="next-chauffeur-4"]');
  const chauffeurRoot = document.querySelector('.chauffeur_flow');
  const firstNameEl = chauffeurRoot?.querySelector('[data-field="contact.first_name"]');
  const lastNameEl = chauffeurRoot?.querySelector('[data-field="contact.last_name"]');
  const emailEl = chauffeurRoot?.querySelector('[data-field="contact.email"]');
  const phoneEl = chauffeurRoot?.querySelector('#chauffeur_contact_phone');
  const termsEl = chauffeurRoot?.querySelector('#accept_terms_chauffeur');

  function isValidEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim()); }

  function validateStep4() {
    const fn = (firstNameEl?.value || "").trim();
    const ln = (lastNameEl?.value || "").trim();
    const em = (emailEl?.value || "").trim();
    const ph = (phoneEl?.value || "").trim();
    const termsOk = !!(termsEl && termsEl.checked);
    if (!fn || !ln) return { ok: false, msg: "Please enter first & last name." };
    if (!isValidEmail(em)) return { ok: false, msg: "Please enter a valid email." };
    if (!ph) return { ok: false, msg: "Please enter a phone number." };
    if (!termsOk) return { ok: false, msg: "Please accept the Terms & Conditions & Privacy Policy." };
    return { ok: true };
  }

  if (backStep4Btn) {
    backStep4Btn.addEventListener("click", (e) => { e.preventDefault(); showChauffeurStep(3); });
  }

  if (nextStep4Btn) {
    nextStep4Btn.addEventListener("click", function (e) {
      e.preventDefault();

      // Build full E164 phone (same pattern as transfer flow)
      let fullPhone = "";
      const iti = window.__chauffeurItiInstance || null;
      if (iti && phoneEl && phoneEl.value.trim()) {
        try {
          const country = iti.getSelectedCountryData();
          const dialCode = country?.dialCode || "";
          const nationalDigits = phoneEl.value.replace(/\D/g, "");
          fullPhone = (dialCode && nationalDigits) ? `+${dialCode}${nationalDigits}` : phoneEl.value.trim();
        } catch (err) {
          console.error("Chauffeur phone capture failed:", err);
          fullPhone = phoneEl.value.trim();
        }
        if (fullPhone && fullPhone !== phoneEl.value) phoneEl.value = fullPhone;
      }

      const v = validateStep4();
      if (!v.ok) { alert(v.msg); return; }

      const st = state();
      st.contact = {
        first_name: (firstNameEl?.value || "").trim(),
        last_name: (lastNameEl?.value || "").trim(),
        email: (emailEl?.value || "").trim(),
        phone: fullPhone || (phoneEl?.value || "").trim()
      };

      const flight = (chauffeurRoot?.querySelector('[data-field="arrival.flight_number"]')?.value || "").trim();
      const vessel = (chauffeurRoot?.querySelector('[data-field="arrival.vessel_name"]')?.value || "").trim();
      st.arrival = { flight_number: flight, vessel_name: vessel };

      st.maxReachedStep = Math.max(Number(st.maxReachedStep || 2), 5);
      showChauffeurStep(5);
    });
  }

  // =========================
  // STEP 5 -> REVIEW + CONFIRM
  // =========================
  function updateReviewSummary() {
    const st = state();

    setTextAll('[data-summary="chauffeur.pickup"]', normalizePlaceName(pickupInput?.dataset?.address || pickupInput?.value) || "-");
    setTextAll('[data-summary="service"]', 'Chauffeur');

    const d = dateInput ? dateInput.value.trim() : "";
    const t = timeInput ? timeInput.value.trim() : "";
    setTextAll('[data-summary="chauffeur.datetime"]', d && t ? `${d}, ${t}` : d || t || "-");

    const hours = Number(durationSelect?.value || 0);
    setTextAll('[data-summary="chauffeur.duration"]', hours ? `${hours} hours` : "-");

    setTextAll('[data-summary="chauffeur.pax"]', document.querySelector('[data-counter-value="chauffeur.pax"]')?.textContent || "-");
    setTextAll('[data-summary="chauffeur.luggage"]', document.querySelector('[data-counter-value="chauffeur.luggage"]')?.textContent || "-");
    setTextAll('[data-summary="chauffeur.vehicle"]', st.vehicle === "vclass" ? "Mercedes-Benz Vito" : "-");

    const price = Number(st.quote?.price_total_eur);
    setTextAll('[data-summary="chauffeur.total"]', Number.isFinite(price) ? `€${price}` : "-");

    setTextAll('[data-summary="contact.first_name"]', st.contact?.first_name || "-");
    setTextAll('[data-summary="contact.last_name"]', st.contact?.last_name || "-");
    setTextAll('[data-summary="contact.email"]', st.contact?.email || "-");
    setTextAll('[data-summary="contact.phone"]', st.contact?.phone || "-");
  }

  async function createHoldFromState() {
    const st = state();
    const pickup_datetime_iso = new Date(`${dateInput.value.trim()}T${timeInput.value.trim()}:00`).toISOString();
    const pax = Number(document.querySelector('[data-counter-value="chauffeur.pax"]')?.textContent || 1);
    const luggage = Number(document.querySelector('[data-counter-value="chauffeur.luggage"]')?.textContent || 1);

    const payload = {
      service_type: "CHAUFFEUR",
      pickup_datetime_iso,
      pickup_place_id: pickupInput?.dataset?.placeId || "",
      pickup_address: pickupInput?.dataset?.address || pickupInput?.value || "",
      duration_hours: Number(durationSelect?.value || 0),
      vehicle: st.vehicle || "vclass",
      passengers: pax,
      luggage: luggage,
      customer_first_name: st.contact?.first_name || "",
      customer_last_name: st.contact?.last_name || "",
      customer_email: st.contact?.email || "",
      customer_phone: st.contact?.phone || "",
      arrival: {
        flight_number: st.arrival?.flight_number || "",
        vessel_name: st.arrival?.vessel_name || ""
      }
    };

    const res = await fetch(HOLD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Hold request failed");
    }
    return res.json();
  }

  async function createCheckout(hold_booking_id) {
    const res = await fetch(CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hold_booking_id })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Checkout request failed");
    }
    return res.json();
  }

  const confirmBtn = document.querySelector(".chauffeur-checkout-button");
  if (confirmBtn) {
    let __confirming = false;
    confirmBtn.addEventListener("click", async function (e) {
      e.preventDefault();
      if (__confirming) return;

      const originalText = confirmBtn.textContent;
      try {
        __confirming = true;
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = "0.7";
        confirmBtn.textContent = "Processing...";

        const hold = await createHoldFromState();
        state().hold = hold;
        const holdId = hold.hold_booking_id || hold.booking_id;
        if (!holdId) throw new Error("Hold created but hold_booking_id missing.");

        const checkout = await createCheckout(holdId);
        if (checkout && checkout.url) {
          window.location.href = checkout.url;
          return;
        }
        throw new Error("Checkout created but no URL returned.");
      } catch (err) {
        console.error("CHAUFFEUR CONFIRM ERROR:", err);
        alert("Could not start checkout:\n" + (err?.message || String(err)));
        __confirming = false;
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = "";
        confirmBtn.textContent = originalText || "CONFIRM BOOKING";
      }
    });
  }

  // Note: showChauffeurStep(2) is called by the service gate when the user picks CHAUFFEUR
});
