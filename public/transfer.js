document.addEventListener("DOMContentLoaded", function () {

  // =========================
  // GLOBAL STATE HELPERS
  // =========================
  function state() {
    window.__VEIN_BOOKING__ = window.__VEIN_BOOKING__ || {};
    return window.__VEIN_BOOKING__;
  }

  function setText(el, value, fallback = "-") {
    if (!el) return;
    const v = (value || "").toString().trim();
    el.textContent = v ? v : fallback;
  }

  function formatDuration(min) {
    const m = Number(min);
    if (!Number.isFinite(m)) return "-";
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h <= 0) return `${r}m`;
    if (r === 0) return `${h}h`;
    return `${h}h ${r}m`;
  }

  // =========================
  // QUOTE FIELD NORMALIZATION
  // =========================
  function qDistanceKm(q) {
    const v = q?.distance_km ?? q?.distanceKm ?? q?.distance ?? null;
    return (v == null) ? null : Number(v);
  }
  function qDurationMin(q) {
    const v = q?.duration_min ?? q?.durationMin ?? q?.duration ?? null;
    return (v == null) ? null : Number(v);
  }
  function qPriceEur(q) {
    const v = q?.price_total_eur ?? q?.priceTotalEur ?? q?.total_eur ?? q?.total ?? null;
    return (v == null) ? null : Number(v);
  }

  // =========================
  // FORCE GAP (Step 3 layout fix)
  // =========================
  function forceStep3Gap() {
    const step3Wrap = document.querySelector('[data-step="transfer-3"]');
    const top = document.querySelector(".transfer-step-3-top");

    if (top) top.style.marginBottom = "30px";

    if (step3Wrap) {
      const cs = window.getComputedStyle(step3Wrap);
      if (cs.display.includes("flex")) {
        step3Wrap.style.justifyContent = "flex-start";
        step3Wrap.style.rowGap = "30px";
        step3Wrap.style.gap = "30px";
      }
    }
  }

  setTimeout(forceStep3Gap, 0);
  window.addEventListener("resize", forceStep3Gap);

  // =========================
  // STEP INDICATOR (clickable + locked)
  // =========================
  function transferStepToUiStep(transferStep) {
    return Math.max(1, Math.min(4, Number(transferStep) - 1));
  }

  function uiStepToTransferStep(uiStep) {
    return Math.max(2, Math.min(5, Number(uiStep) + 1));
  }

  function updateStepIndicator(transferStepCurrent) {
    const st = state();
    const uiCurrent = transferStepToUiStep(transferStepCurrent);
    const uiMaxReached = Number(st.uiMaxReachedStep || uiCurrent || 1);

    document.querySelectorAll("[data-step-indicator]").forEach(stepEl => {
      const stepNum = Number(stepEl.getAttribute("data-step-indicator"));
      stepEl.classList.remove("is-completed", "is-active", "is-locked");

      if (stepNum < uiCurrent) stepEl.classList.add("is-completed");
      if (stepNum === uiCurrent) stepEl.classList.add("is-active");
      if (stepNum > uiMaxReached) stepEl.classList.add("is-locked");
    });

    document.querySelectorAll("[data-step-line]").forEach(lineEl => {
      const lineNum = Number(lineEl.getAttribute("data-step-line"));
      lineEl.classList.remove("is-completed");
      if (uiCurrent >= lineNum) lineEl.classList.add("is-completed");
    });
  }

  function wireStepIndicatorClicks(showTransferStepFn) {
    document.querySelectorAll("[data-step-indicator]").forEach(stepEl => {
      stepEl.style.cursor = "pointer";

      stepEl.addEventListener("click", function () {
        const st = state();
        const uiMaxReached = Number(st.uiMaxReachedStep || 1);
        const uiTarget = Number(stepEl.getAttribute("data-step-indicator"));
        if (uiTarget > uiMaxReached) return;
        showTransferStepFn(uiStepToTransferStep(uiTarget));
      });
    });
  }

  // =========================
  // TRANSFER STEP SHOW/HIDE
  // =========================
  const step2 = document.querySelector('[data-step="transfer-2"]');
  const step3 = document.querySelector('[data-step="transfer-3"]');
  const step4 = document.querySelector('[data-step="transfer-4"]');
  const step5 = document.querySelector('[data-step="transfer-5"]');

  function showTransferStep(n) {
    const st = state();
    st.currentStep = n;

    st.maxReachedStep = Math.max(Number(st.maxReachedStep || 2), n);
    const uiN = transferStepToUiStep(n);
    st.uiMaxReachedStep = Math.max(Number(st.uiMaxReachedStep || 1), uiN);

    if (step2) step2.style.display = (n === 2) ? "block" : "none";
    if (step3) step3.style.display = (n === 3) ? "block" : "none";
    if (step4) step4.style.display = (n === 4) ? "block" : "none";
    if (step5) step5.style.display = (n === 5) ? "block" : "none";

    updateStepIndicator(n);
    setTimeout(forceStep3Gap, 0);

    if (n === 4) setTimeout(initPhoneInputOnce, 50);
    if (n === 5) updateTransferReviewSummary();
  }

  window.showTransferStep = showTransferStep;

  // =========================
  // FLATPICKR (Date/Time)
  // =========================
  const dateInput = document.querySelector('input[data-picker="date"]');
  const timeInput = document.querySelector('input[data-picker="time"]');
  const datetimeSummary = document.querySelector('[data-summary="transfer.datetime"]');

  function syncDatetime() {
    const d = dateInput ? dateInput.value.trim() : "";
    const t = timeInput ? timeInput.value.trim() : "";
    if (!d && !t) return setText(datetimeSummary, "", "-");
    if (d && t) return setText(datetimeSummary, `${d}, ${t}`, "-");
    return setText(datetimeSummary, d || t, "-");
  }

  if (window.flatpickr) {
    flatpickr('[data-picker="date"]', {
      dateFormat: "Y-m-d",
      minDate: "today",
      disableMobile: true,
      onClose: syncDatetime
    });

    flatpickr('[data-picker="time"]', {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      time_24hr: true,
      minuteIncrement: 15,
      disableMobile: true,
      onClose: syncDatetime
    });
  }

  if (dateInput) dateInput.addEventListener("blur", syncDatetime);
  if (timeInput) timeInput.addEventListener("blur", syncDatetime);

  // =========================
  // GOOGLE PLACES (Pickup/Dropoff)
  // =========================
  const pickupInput = document.getElementById("pickup_location");
  const dropoffInput = document.getElementById("dropoff_location");

  const pickupSummary = document.querySelector('[data-summary="transfer.pickup"]');
  const dropoffSummary = document.querySelector('[data-summary="transfer.dropoff"]');

  function syncPickupCommitted() {
    if (!pickupInput) return;
    const v = pickupInput.dataset.address || pickupInput.value;
    setText(pickupSummary, v);
  }

  function syncDropoffCommitted() {
    if (!dropoffInput) return;
    const v = dropoffInput.dataset.address || dropoffInput.value;
    setText(dropoffSummary, v);
  }

  if (pickupInput && dropoffInput && window.google && google.maps && google.maps.places) {
    const options = {
      fields: ["place_id", "formatted_address", "geometry", "name"],
      componentRestrictions: { country: ["gr"] }
    };

    const pickupAC = new google.maps.places.Autocomplete(pickupInput, options);
    const dropoffAC = new google.maps.places.Autocomplete(dropoffInput, options);

    function storePlace(ac, inputEl) {
      const place = ac.getPlace();
      if (!place || !place.place_id) return null;

      const display = place.formatted_address || place.name || inputEl.value;

      inputEl.dataset.placeId = place.place_id;
      inputEl.dataset.address = display;

      const lat = place.geometry?.location?.lat?.();
      const lng = place.geometry?.location?.lng?.();
      if (typeof lat === "number" && typeof lng === "number") {
        inputEl.dataset.lat = String(lat);
        inputEl.dataset.lng = String(lng);
      }
      return display;
    }

    pickupAC.addListener("place_changed", () => {
      storePlace(pickupAC, pickupInput);
      syncPickupCommitted();
    });

    dropoffAC.addListener("place_changed", () => {
      storePlace(dropoffAC, dropoffInput);
      syncDropoffCommitted();
    });
  }

  if (pickupInput) pickupInput.addEventListener("blur", syncPickupCommitted);
  if (dropoffInput) dropoffInput.addEventListener("blur", syncDropoffCommitted);

  // =========================
  // COUNTERS
  // =========================
  const limits = {
    "transfer.pax": { min: 1, max: 6 },
    "transfer.luggage": { min: 1, max: 6 }
  };

  function syncCounterToSummary(field) {
    const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
    const summaryEl = document.querySelector(`[data-summary="${field}"]`);
    if (!valueEl || !summaryEl) return;
    summaryEl.textContent = valueEl.textContent;
  }

  function updateValue(field, newValue) {
    const config = limits[field];
    if (!config) return;

    const clamped = Math.max(config.min, Math.min(config.max, newValue));
    const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
    if (valueEl) valueEl.textContent = clamped;
    syncCounterToSummary(field);
  }

  document.querySelectorAll('[data-counter]').forEach(btn => {
    btn.addEventListener("click", function () {
      const field = this.getAttribute("data-field");
      const type = this.getAttribute("data-counter");
      const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
      if (!valueEl) return;

      let current = parseInt(valueEl.textContent || "0", 10);
      if (type === "plus") current++;
      if (type === "minus") current--;
      updateValue(field, current);
    });
  });

  ["transfer.pax", "transfer.luggage"].forEach(syncCounterToSummary);
  syncDatetime();

  // =========================
  // BUTTON LOADING
  // =========================
  function setBtnLoading(btn, isLoading, loadingText, idleText) {
    if (!btn) return;

    const label = btn.querySelector("[data-btn-label]");
    btn.disabled = isLoading;
    btn.style.opacity = isLoading ? "0.7" : "";

    if (label) {
      label.textContent = isLoading ? loadingText : idleText;
    } else {
      btn.textContent = isLoading ? loadingText : idleText;
    }
  }

  // =========================
  // STEP 2 -> QUOTE
  // =========================
  const QUOTE_ENDPOINT = "https://vein-booking-api.vercel.app/api/quote";
  const nextStep2Btn = document.querySelector('[data-action="next-transfer-2"]');

  const distanceEl = document.querySelector('[data-summary="transfer.distanceKm"]');
  const durationEl = document.querySelector('[data-summary="transfer.duration"]');
  const totalEl = document.querySelector('[data-summary="transfer.total"]');

  function validateStep2() {
    const pickupOk = !!(pickupInput && pickupInput.dataset.placeId);
    const dropoffOk = !!(dropoffInput && dropoffInput.dataset.placeId);
    const dateOk = !!(dateInput && dateInput.value.trim());
    const timeOk = !!(timeInput && timeInput.value.trim());
    return pickupOk && dropoffOk && dateOk && timeOk;
  }

  async function requestQuote() {
    const pickup_datetime_iso = new Date(
      `${dateInput.value.trim()}T${timeInput.value.trim()}:00`
    ).toISOString();

    const payload = {
      service_type: "TRANSFER",
      pickup_datetime_iso,
      pickup_place_id: pickupInput.dataset.placeId,
      dropoff_place_id: dropoffInput.dataset.placeId
    };

    const res = await fetch(QUOTE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Quote request failed");
    }

    return res.json();
  }

  function renderQuote(quote) {
    const km = qDistanceKm(quote);
    const min = qDurationMin(quote);
    const price = qPriceEur(quote);

    if (distanceEl) distanceEl.textContent = (km != null && Number.isFinite(km)) ? `${km}` : "-";
    if (durationEl) durationEl.textContent = (min != null && Number.isFinite(min)) ? formatDuration(min) : "-";
    if (totalEl) totalEl.textContent = "-";

    const vehiclePriceEl2 = document.querySelector('[data-vehicle-price="vclass"]');
    if (vehiclePriceEl2) {
      vehiclePriceEl2.textContent = (price != null && Number.isFinite(price)) ? `€${price}` : "-";
    }
  }

  if (nextStep2Btn) {
    nextStep2Btn.addEventListener("click", async function (e) {
      e.preventDefault();

      if (!validateStep2()) {
        alert("Please complete pickup, dropoff, date and time.");
        return;
      }

      try {
        setBtnLoading(nextStep2Btn, true, "Calculating...", "Next");
        const quote = await requestQuote();

        const st = state();
        st.quote = quote;

        renderQuote(quote);
        st.maxReachedStep = Math.max(Number(st.maxReachedStep || 2), 3);
        showTransferStep(3);

      } catch (err) {
        console.error("QUOTE ERROR:", err);
        alert("Quote failed:\n" + (err && err.message ? err.message : String(err)));
      } finally {
        setBtnLoading(nextStep2Btn, false, "", "Next");
      }
    });
  }

  // =========================
  // STEP 3 -> VEHICLE SELECT
  // =========================
  const backStep3Btn = document.querySelector('[data-action="back-transfer-3"]');
  const nextStep3Btn = document.querySelector('[data-action="next-transfer-3"]');

  const selectVehicleBtn = document.querySelector('[data-action="select-vehicle"][data-vehicle="vclass"]');
  const vehiclePriceEl = document.querySelector('[data-vehicle-price="vclass"]');
  const summaryVehicleEl = document.querySelector('[data-summary="transfer.vehicle"]');
  const selectVehicleLabelEl = document.querySelector('[data-vehicle-select-label="vclass"]');

  function setNextEnabled(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "" : "0.5";
    btn.style.pointerEvents = enabled ? "" : "none";
  }

  function refreshVehiclePriceFromQuote() {
    const q = state().quote;
    const price = qPriceEur(q);
    if (!vehiclePriceEl) return;

    vehiclePriceEl.textContent =
      (price != null && Number.isFinite(price)) ? `€${price}` : (vehiclePriceEl.textContent || "-");
  }

  function setVehicleSelectedUI(isSelected) {
    const labelText = isSelected ? "SELECTED" : "SELECT";
    if (selectVehicleLabelEl) {
      selectVehicleLabelEl.textContent = labelText;
    } else if (selectVehicleBtn) {
      selectVehicleBtn.textContent = labelText;
    }

    if (selectVehicleBtn) {
      selectVehicleBtn.classList.toggle("is-selected", !!isSelected);
      selectVehicleBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    }
  }

  refreshVehiclePriceFromQuote();
  setNextEnabled(nextStep3Btn, false);

  if (state().vehicle === "vclass") {
    setVehicleSelectedUI(true);
    setNextEnabled(nextStep3Btn, true);
    if (summaryVehicleEl) summaryVehicleEl.textContent = "Mercedes-Benz V Class";
  } else {
    setVehicleSelectedUI(false);
  }

  if (selectVehicleBtn) {
    selectVehicleBtn.addEventListener("click", function (e) {
      e.preventDefault();

      const st = state();
      st.vehicle = "vclass";

      if (summaryVehicleEl) summaryVehicleEl.textContent = "Mercedes-Benz V Class";

      setVehicleSelectedUI(true);
      setNextEnabled(nextStep3Btn, true);
    });
  }

  if (backStep3Btn) {
    backStep3Btn.addEventListener("click", function (e) {
      e.preventDefault();
      showTransferStep(2);
    });
  }

  if (nextStep3Btn) {
    nextStep3Btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (nextStep3Btn.disabled) return;

      const st = state();
      st.maxReachedStep = Math.max(Number(st.maxReachedStep || 2), 4);
      showTransferStep(4);
    });
  }

  // =========================
  // STEP 4 -> CONTACT
  // =========================
  const backStep4Btn = document.querySelector('[data-action="back-transfer-4"]');
  const nextStep4Btn = document.querySelector('[data-action="next-transfer-4"]');

  const firstNameEl = document.querySelector('[data-field="contact.first_name"]');
  const lastNameEl  = document.querySelector('[data-field="contact.last_name"]');
  const emailEl     = document.querySelector('[data-field="contact.email"]');
  const phoneEl     = document.getElementById("contact_phone");
  const termsEl = document.getElementById("accept_terms");

  function validateStep4() {
    const fn = (firstNameEl ? firstNameEl.value : "").trim();
    const ln = (lastNameEl ? lastNameEl.value : "").trim();
    const em = (emailEl ? emailEl.value : "").trim();
    const ph = (phoneEl ? phoneEl.value : "").trim();
    const termsOk = !!(termsEl && termsEl.checked);

    if (!fn || !ln) return { ok: false, msg: "Please enter first & last name." };
    if (!isValidEmail(em)) return { ok: false, msg: "Please enter a valid email." };
    if (!ph) return { ok: false, msg: "Please enter a phone number." };
    if (!termsOk) return { ok: false, msg: "Please accept the Terms & Conditions & Privacy Policy." };

    return { ok: true };
  }

  if (backStep4Btn) {
    backStep4Btn.addEventListener("click", function (e) {
      e.preventDefault();
      showTransferStep(3);
    });
  }

  if (nextStep4Btn) {
    nextStep4Btn.addEventListener("click", function (e) {
      e.preventDefault();

      const v = validateStep4();
      if (!v.ok) {
        alert(v.msg);
        return;
      }

      const st = state();
      st.contact = {
        first_name: (firstNameEl?.value || "").trim(),
        last_name: (lastNameEl?.value || "").trim(),
        email: (emailEl?.value || "").trim(),
        phone: (phoneEl?.value || "").trim()
      };

      const flight = (document.querySelector('[data-field="arrival.flight_number"]')?.value || "").trim();
      const vessel = (document.querySelector('[data-field="arrival.vessel_name"]')?.value || "").trim();
      st.arrival = { flight_number: flight, vessel_name: vessel };

      st.maxReachedStep = Math.max(Number(st.maxReachedStep || 2), 5);
      showTransferStep(5);
    });
  }

  // =========================
  // STEP 5 -> REVIEW + CONFIRM
  // =========================
  const HOLD_ENDPOINT = "https://vein-booking-api.vercel.app/api/hold";
  const CHECKOUT_ENDPOINT = "https://vein-booking-api.vercel.app/api/checkout";

  function updateTransferReviewSummary() {
    const st = state();
    const quote = st.quote || {};

    setText(document.querySelector('[data-summary="transfer.pickup"]'), pickupInput?.dataset?.address || pickupInput?.value || "-");
    setText(document.querySelector('[data-summary="transfer.dropoff"]'), dropoffInput?.dataset?.address || dropoffInput?.value || "-");
    syncDatetime();

    setText(document.querySelector('[data-summary="transfer.pax"]'), (document.querySelector('[data-counter-value="transfer.pax"]')?.textContent || "-"));
    setText(document.querySelector('[data-summary="transfer.luggage"]'), (document.querySelector('[data-counter-value="transfer.luggage"]')?.textContent || "-"));

    setText(document.querySelector('[data-summary="transfer.vehicle"]'), st.vehicle === "vclass" ? "Mercedes-Benz V Class" : "-");

    const km = qDistanceKm(quote);
    const min = qDurationMin(quote);
    const price = qPriceEur(quote);

    setText(document.querySelector('[data-summary="transfer.distanceKm"]'), (km != null && Number.isFinite(km)) ? String(km) : "-");
    setText(document.querySelector('[data-summary="transfer.duration"]'), (min != null && Number.isFinite(min)) ? formatDuration(min) : "-");

    const totalEl2 = document.querySelector('[data-summary="transfer.total"]');
    if (totalEl2) totalEl2.textContent = (price != null && Number.isFinite(price)) ? `€${price}` : "-";

    setText(document.querySelector('[data-summary="contact.first_name"]'), st.contact?.first_name || "-");
    setText(document.querySelector('[data-summary="contact.last_name"]'), st.contact?.last_name || "-");
    setText(document.querySelector('[data-summary="contact.email"]'), st.contact?.email || "-");
    setText(document.querySelector('[data-summary="contact.phone"]'), st.contact?.phone || "-");
  }

  window.updateTransferReviewSummary = updateTransferReviewSummary;

  async function createHoldFromState() {
    const st = state();
    const quote = st.quote || {};

    const pickup_datetime_iso = new Date(`${dateInput.value.trim()}T${timeInput.value.trim()}:00`).toISOString();
    const pax = Number(document.querySelector('[data-counter-value="transfer.pax"]')?.textContent || 1);
    const luggage = Number(document.querySelector('[data-counter-value="transfer.luggage"]')?.textContent || 1);

    const payload = {
      service_type: "TRANSFER",
      pickup_datetime_iso,
      pickup_place_id: pickupInput?.dataset?.placeId || "",
      dropoff_place_id: dropoffInput?.dataset?.placeId || "",
      pickup_address: pickupInput?.dataset?.address || pickupInput?.value || "",
      dropoff_address: dropoffInput?.dataset?.address || dropoffInput?.value || "",
      distance_km: quote.distance_km ?? quote.distanceKm ?? quote.distance,
      duration_min: quote.duration_min ?? quote.durationMin ?? quote.duration,
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

  const confirmBtn = document.querySelector(".checkout-button");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async function (e) {
      e.preventDefault();

      const originalText = confirmBtn.textContent;

      try {
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
        console.error("CONFIRM ERROR:", err);
        alert("Could not start checkout:\n" + (err && err.message ? err.message : String(err)));
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = "";
        confirmBtn.textContent = originalText || "CONFIRM BOOKING";
      }
    });
  }

  // =========================
  // PHONE INIT
  // =========================
  let __itiInstance = null;

  function forceDropdownScrollable() {
    const dd = document.querySelector(".iti__dropdown-content");
    const list = document.querySelector(".iti__country-list");
    if (dd) {
      dd.style.maxHeight = "260px";
      dd.style.overflowY = "auto";
      dd.style.overscrollBehavior = "contain";
      dd.style.webkitOverflowScrolling = "touch";
    }
    if (list) {
      list.style.maxHeight = "260px";
      list.style.overflowY = "auto";
      list.style.overscrollBehavior = "contain";
      list.style.webkitOverflowScrolling = "touch";
    }
  }

  function initPhoneInputOnce() {
    const phoneInput = document.getElementById("contact_phone");
    if (!phoneInput) return;
    if (!window.intlTelInput) return;
    if (__itiInstance) return;

    __itiInstance = window.intlTelInput(phoneInput, {
      initialCountry: "gr",
      separateDialCode: true,
      nationalMode: true,
      dropdownContainer: document.body
    });

    forceDropdownScrollable();
    phoneInput.addEventListener("open:countrydropdown", forceDropdownScrollable);

    document.addEventListener("wheel", (e) => {
      const inside = e.target.closest(".iti__country-list, .iti__dropdown-content, .iti__dropdown");
      if (inside) e.stopPropagation();
    }, { passive: true, capture: true });

    phoneInput.addEventListener("blur", function () {
      if (!phoneInput.value.trim()) return;
      const full = __itiInstance.getNumber();
      if (full) phoneInput.value = full;
    });
  }

  setTimeout(initPhoneInputOnce, 0);

  // =========================
  // INIT
  // =========================
  const st = state();
  st.maxReachedStep = Number(st.maxReachedStep || 2);

  wireStepIndicatorClicks(showTransferStep);
  showTransferStep(Number(st.currentStep || 2));
});