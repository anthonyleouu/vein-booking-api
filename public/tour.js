document.addEventListener("DOMContentLoaded", function () {
  console.log("TOUR JS VERSION 20260307-207");

  function state() {
    window.__VEIN_BOOKING__ = window.__VEIN_BOOKING__ || {};
    return window.__VEIN_BOOKING__;
  }

  function ensureTourState() {
    const st = state();

    st.tour = st.tour || {};
    st.tourContact = st.tourContact || {};

    st.tour = {
      tour_id: "",
      tour_name: "",
      duration: "",
      passengers: 1,
      extra_hours: 0,
      pickup_datetime_iso: "",
      pickup_mode: "athens_center",
      pickup_place_id: "",
      pickup_address: "",
      dropoff_mode: "athens_center",
      dropoff_place_id: "",
      dropoff_address: "",
      quote: null,
      hold: null,
      arrival: {
        flight_number: "",
        vessel_name: "",
      },
      ...st.tour,
      arrival: {
        flight_number: "",
        vessel_name: "",
        ...(st.tour?.arrival || {}),
      },
    };

    st.tourContact = {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      ...st.tourContact,
    };

    st.tourCurrentStep = Number(st.tourCurrentStep || 1);
    st.tourMaxReachedStep = Number(st.tourMaxReachedStep || 1);

    return st;
  }

  function setText(el, value, fallback = "-") {
    if (!el) return;
    const v = (value || "").toString().trim();
    el.textContent = v ? v : fallback;
  }

  function formatDateTime(dateStr, timeStr) {
    if (!dateStr && !timeStr) return "-";
    if (dateStr && timeStr) return `${dateStr}, ${timeStr}`;
    return dateStr || timeStr || "-";
  }

  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
  }

  function presetLabelForMode(mode) {
    if (mode === "airport") return "Athens International Airport";
    if (mode === "piraeus_port") return "Piraeus Port";
    if (mode === "athens_center") return "Athens Center";
    if (mode === "same_as_pickup") return "Same as Pickup";
    if (mode === "custom") return "Custom Address";
    return "-";
  }

  function firstNonEmpty(...vals) {
    for (const v of vals) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  }

  function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getTourReviewRoot() {
  return document.querySelector('[data-step="tour-4"]') || step4 || document;
}

function setSummaryText(summaryKey, value, fallback = "-") {
  const root = getTourReviewRoot();
  root.querySelectorAll(`[data-summary="${summaryKey}"]`).forEach((el) => {
    const v = (value || "").toString().trim();
    el.textContent = v ? v : fallback;
  });
}

function toggleSummaryBlockBySummaryKey(summaryKey, show) {
  const root = document.querySelector('[data-step="tour-4"]') || step4 || document;

  root.querySelectorAll(`[data-summary="${summaryKey}"]`).forEach((valueEl) => {
    const block = valueEl.closest(".summary-block");
    if (!block) return;

    if (show) {
      block.style.removeProperty("display");
      block.style.setProperty("display", "flex", "important");
    } else {
      block.style.setProperty("display", "none", "important");
    }
  });
}

  function getAttrDeep(el, attrName) {
    if (!el) return "";

    const selfVal = el.getAttribute?.(attrName);
    if (selfVal && String(selfVal).trim()) return String(selfVal).trim();

    const ancestor = el.closest?.(`[${attrName}]`);
    const ancestorVal = ancestor?.getAttribute?.(attrName);
    if (ancestorVal && String(ancestorVal).trim()) return String(ancestorVal).trim();

    const child = el.querySelector?.(`[${attrName}]`);
    const childVal = child?.getAttribute?.(attrName);
    if (childVal && String(childVal).trim()) return String(childVal).trim();

    return "";
  }

  function getTourCardRoot(el) {
    if (!el) return null;
    return (
      el.closest?.("[data-tour-card]") ||
      el.closest?.("[data-tour-select]") ||
      el.closest?.("[data-tour-id]") ||
      null
    );
  }

  function extractTourData(el) {
    const root = getTourCardRoot(el) || el;

    const tour_id = firstNonEmpty(
      getAttrDeep(el, "data-tour-id"),
      getAttrDeep(root, "data-tour-id")
    );

    const tour_name = firstNonEmpty(
      getAttrDeep(el, "data-tour-name"),
      getAttrDeep(root, "data-tour-name")
    );

    const duration = firstNonEmpty(
      getAttrDeep(el, "data-tour-duration"),
      getAttrDeep(root, "data-tour-duration")
    );

    return {
      root,
      tour_id,
      tour_name,
      duration,
    };
  }

  function setSelectedTourState(data) {
    const st = ensureTourState();

    st.tour.tour_id = firstNonEmpty(data?.tour_id, st.tour.tour_id);
    st.tour.tour_name = firstNonEmpty(data?.tour_name, st.tour.tour_name);
    st.tour.duration = firstNonEmpty(data?.duration, st.tour.duration);

    return st.tour;
  }

  function clearTourCardSelection() {
    document.querySelectorAll("[data-tour-card], [data-tour-select], [data-tour-id]").forEach((el) => {
      el.classList.remove("is-selected");
      el.setAttribute("aria-pressed", "false");
      el.setAttribute("aria-selected", "false");
    });
  }

  function markTourCardSelected(root) {
    if (!root) return;

    root.classList.add("is-selected");
    root.setAttribute("aria-pressed", "true");
    root.setAttribute("aria-selected", "true");

    const innerSelect = root.querySelector?.("[data-tour-select]");
    if (innerSelect) {
      innerSelect.classList.add("is-selected");
      innerSelect.setAttribute("aria-pressed", "true");
      innerSelect.setAttribute("aria-selected", "true");
    }
  }

  const TOUR_QUOTE_ENDPOINT = "https://vein-booking-api.vercel.app/api/quote";
  const TOUR_HOLD_ENDPOINT = "https://vein-booking-api.vercel.app/api/hold";
  const TOUR_CHECKOUT_ENDPOINT = "https://vein-booking-api.vercel.app/api/checkout";

  const step1 = document.querySelector('[data-step="tour-1"]');
  const step2 = document.querySelector('[data-step="tour-2"]');
  const step3 = document.querySelector('[data-step="tour-3"]');
  const step4 = document.querySelector('[data-step="tour-4"]');

  function updateTourStepIndicator(tourStepCurrent) {
  const st = ensureTourState();
  const current = Number(tourStepCurrent || 1);
  const maxReached = Number(st.tourMaxReachedStep || current || 1);

  document.querySelectorAll("[data-tour-step-indicator]").forEach((stepEl) => {
    const stepNum = Number(stepEl.getAttribute("data-tour-step-indicator"));

    stepEl.classList.remove("is-completed", "is-active", "is-locked");

    if (stepNum < current) stepEl.classList.add("is-completed");
    if (stepNum === current) stepEl.classList.add("is-active");
    if (stepNum > maxReached) stepEl.classList.add("is-locked");

    // always allow clicks on reachable steps
    stepEl.style.pointerEvents = stepNum <= maxReached ? "auto" : "none";
    stepEl.style.cursor = stepNum <= maxReached ? "pointer" : "default";
  });

  document.querySelectorAll("[data-tour-step-line]").forEach((lineEl) => {
    const lineNum = Number(lineEl.getAttribute("data-tour-step-line"));
    lineEl.classList.remove("is-completed");
    if (current >= lineNum) lineEl.classList.add("is-completed");
  });
}

  function showTourStep(n) {
  const st = ensureTourState();
  st.tourCurrentStep = n;
  st.tourMaxReachedStep = Math.max(Number(st.tourMaxReachedStep || 1), n);

  if (step1) step1.style.display = n === 1 ? "block" : "none";
  if (step2) step2.style.display = n === 2 ? "block" : "none";
  if (step3) step3.style.display = n === 3 ? "block" : "none";
  if (step4) step4.style.display = n === 4 ? "block" : "none";

  updateTourStepIndicator(n);

  if (n === 3) setTimeout(initTourPhoneInputOnce, 50);

  if (n === 4) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateTourReviewSummary();
  });
  });
}
}

  window.showTourStep = showTourStep;

  function bindTourCards() {
    document.addEventListener("click", function (e) {
      const trigger = e.target.closest("[data-tour-select], [data-tour-card], [data-tour-id]");
      if (!trigger) return;

      const data = extractTourData(trigger);

      if (!data.root) return;
      if (!data.tour_id) {
        console.warn("Tour click detected, but no data-tour-id found.", {
          trigger,
          root: data.root
        });
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      clearTourCardSelection();
      markTourCardSelected(data.root);
      setSelectedTourState(data);

      const st = ensureTourState();
      st.tourMaxReachedStep = Math.max(Number(st.tourMaxReachedStep || 1), 2);

      console.log("Selected tour:", {
        tour_id: st.tour.tour_id,
        tour_name: st.tour.tour_name,
        duration: st.tour.duration
      });

      showTourStep(2);
    });
  }

  function wireTourStepIndicatorClicks() {
  document.querySelectorAll("[data-tour-step-indicator]").forEach((stepEl) => {
    stepEl.style.cursor = "pointer";
    stepEl.style.pointerEvents = "auto";

    stepEl.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const st = ensureTourState();
      const maxReached = Number(st.tourMaxReachedStep || 1);
      const targetStep = Number(stepEl.getAttribute("data-tour-step-indicator"));

      console.log("TOUR STEP CLICK", {
        targetStep,
        maxReached,
        currentStep: st.tourCurrentStep
      });

      if (!targetStep) return;
      if (targetStep > maxReached) return;

      showTourStep(targetStep);
    });
  });
}

  const tourDateInput = document.querySelector('input[data-tour-picker="date"]');
  const tourTimeInput = document.querySelector('input[data-tour-picker="time"]');

  if (window.flatpickr) {
    if (tourDateInput) {
      flatpickr(tourDateInput, {
        dateFormat: "Y-m-d",
        minDate: "today",
        disableMobile: true,
      });
    }

    if (tourTimeInput) {
      flatpickr(tourTimeInput, {
        enableTime: true,
        noCalendar: true,
        dateFormat: "H:i",
        time_24hr: true,
        minuteIncrement: 15,
        minTime: "08:00",
        maxTime: "11:00",
        disableMobile: true,
      });
    }
  }

  const limits = {
    "tour.guests": { min: 1, max: 6 },
    "tour.extra_hours": { min: 0, max: 12 },
  };

  function updateCounterValue(field, newValue) {
    const cfg = limits[field];
    if (!cfg) return;

    const st = ensureTourState();
    const clamped = Math.max(cfg.min, Math.min(cfg.max, Number(newValue || 0)));

    const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
    if (valueEl) valueEl.textContent = String(clamped);

    if (field === "tour.guests") st.tour.passengers = clamped;
    if (field === "tour.extra_hours") st.tour.extra_hours = clamped;
  }

  document.querySelectorAll("[data-counter]").forEach((btn) => {
    btn.addEventListener("click", function () {
      const field = this.getAttribute("data-field");
      const type = this.getAttribute("data-counter");
      const valueEl = document.querySelector(`[data-counter-value="${field}"]`);
      const current = parseInt(valueEl?.textContent || "0", 10);

      if (type === "plus") updateCounterValue(field, current + 1);
      if (type === "minus") updateCounterValue(field, current - 1);
    });
  });

  updateCounterValue("tour.guests", 1);
  updateCounterValue("tour.extra_hours", 0);

  function setWebflowRadioChecked(selector, value) {
    const radios = document.querySelectorAll(selector);

    radios.forEach((radio) => {
      radio.checked = false;
      radio.removeAttribute("checked");

      const fake = radio.parentElement?.querySelector(".w-radio-input");
      if (fake) fake.classList.remove("w--redirected-checked");
    });

    const target = Array.from(radios).find((radio) => {
      return (
        radio.value === value ||
        radio.getAttribute("data-tour-pickup-mode") === value ||
        radio.getAttribute("data-tour-dropoff-mode") === value
      );
    });

    if (target) {
      target.checked = true;
      target.setAttribute("checked", "checked");

      const fake = target.parentElement?.querySelector(".w-radio-input");
      if (fake) fake.classList.add("w--redirected-checked");
    }
  }

  function getCheckedTourMode(selector, attrName, fallback) {
    const checked = Array.from(document.querySelectorAll(selector)).find((el) => el.checked);
    return checked?.getAttribute(attrName) || checked?.value || fallback;
  }

  function normalizeTourRadioSettings() {
    const pickupRadios = document.querySelectorAll("[data-tour-pickup-mode]");
    const dropoffRadios = document.querySelectorAll("[data-tour-dropoff-mode]");

    pickupRadios.forEach((radio) => {
      const mode = radio.getAttribute("data-tour-pickup-mode");
      radio.setAttribute("name", "tour_pickup_mode");
      if (mode) radio.value = mode;
    });

    dropoffRadios.forEach((radio) => {
      const mode = radio.getAttribute("data-tour-dropoff-mode");
      radio.setAttribute("name", "tour_dropoff_mode");
      if (mode) radio.value = mode;
    });
  }

  const pickupAddressWrap = document.querySelector('[data-tour-visible="pickup-address"]');
  const dropoffAddressWrap = document.querySelector('[data-tour-visible="dropoff-address"]');
  const flightWrap = document.querySelector('[data-tour-visible="flight-field"]');
  const shipWrap = document.querySelector('[data-tour-visible="ship-field"]');

  function syncTourModeVisibility() {
    const st = ensureTourState();

    const pickupNeedsAddress =
      st.tour.pickup_mode === "athens_center" || st.tour.pickup_mode === "custom";

    const effectiveDropoffMode =
      st.tour.dropoff_mode === "same_as_pickup" ? st.tour.pickup_mode : st.tour.dropoff_mode;

    const dropoffNeedsAddress =
      effectiveDropoffMode === "athens_center" || effectiveDropoffMode === "custom";

    if (pickupAddressWrap) {
      pickupAddressWrap.style.display = pickupNeedsAddress ? "block" : "none";
    }

    if (dropoffAddressWrap) {
      dropoffAddressWrap.style.display =
        st.tour.dropoff_mode === "same_as_pickup"
          ? "none"
          : (dropoffNeedsAddress ? "block" : "none");
    }

    if (st.tour.dropoff_mode === "same_as_pickup") {
      st.tour.dropoff_place_id = st.tour.pickup_place_id || "";
      st.tour.dropoff_address = st.tour.pickup_address || "";
    }

    if (flightWrap) {
      flightWrap.style.display = st.tour.pickup_mode === "airport" ? "block" : "none";
    }

    if (shipWrap) {
      shipWrap.style.display = st.tour.pickup_mode === "piraeus_port" ? "block" : "none";
    }
  }

  function applyTourDefaultRadios() {
    setWebflowRadioChecked("[data-tour-pickup-mode]", "athens_center");
    setWebflowRadioChecked("[data-tour-dropoff-mode]", "athens_center");

    const st = ensureTourState();
    st.tour.pickup_mode = getCheckedTourMode("[data-tour-pickup-mode]", "data-tour-pickup-mode", "athens_center");
    st.tour.dropoff_mode = getCheckedTourMode("[data-tour-dropoff-mode]", "data-tour-dropoff-mode", "athens_center");

    console.log("Applied default tour radio modes:", {
      pickup_mode: st.tour.pickup_mode,
      dropoff_mode: st.tour.dropoff_mode
    });
  }

  function syncTourModesFromDom() {
    const st = ensureTourState();

    st.tour.pickup_mode = getCheckedTourMode(
      "[data-tour-pickup-mode]",
      "data-tour-pickup-mode",
      st.tour.pickup_mode || "athens_center"
    );

    st.tour.dropoff_mode = getCheckedTourMode(
      "[data-tour-dropoff-mode]",
      "data-tour-dropoff-mode",
      st.tour.dropoff_mode || "athens_center"
    );
  }

  document.querySelectorAll("[data-tour-pickup-mode]").forEach((input) => {
    input.addEventListener("change", function () {
      if (!this.checked) return;

      const mode = this.getAttribute("data-tour-pickup-mode") || "athens_center";
      setWebflowRadioChecked("[data-tour-pickup-mode]", mode);

      const st = ensureTourState();
      st.tour.pickup_mode = mode;

      if (st.tour.dropoff_mode === "same_as_pickup") {
        st.tour.dropoff_place_id = st.tour.pickup_place_id || "";
        st.tour.dropoff_address = st.tour.pickup_address || "";
      }

      syncTourModeVisibility();
    });
  });

  document.querySelectorAll("[data-tour-dropoff-mode]").forEach((input) => {
    input.addEventListener("change", function () {
      if (!this.checked) return;

      const mode = this.getAttribute("data-tour-dropoff-mode") || "athens_center";
      setWebflowRadioChecked("[data-tour-dropoff-mode]", mode);

      const st = ensureTourState();
      st.tour.dropoff_mode = mode;

      syncTourModeVisibility();
    });
  });

  const tourPickupInput = document.getElementById("tour_pickup_location");
  const tourDropoffInput = document.getElementById("tour_dropoff_location");

  function attachTourPlaces() {
    if (!window.google || !google.maps || !google.maps.places) return;

    const options = {
      fields: ["place_id", "formatted_address", "geometry", "name"],
      componentRestrictions: { country: ["gr"] }
    };

    function storePlace(ac, inputEl, type) {
      const place = ac.getPlace();
      if (!place || !place.place_id) return;

      const st = ensureTourState();
      const display = place.formatted_address || place.name || inputEl.value || "";

      inputEl.dataset.placeId = place.place_id;
      inputEl.dataset.address = display;

      if (type === "pickup") {
        st.tour.pickup_place_id = place.place_id;
        st.tour.pickup_address = display;

        if (st.tour.dropoff_mode === "same_as_pickup") {
          st.tour.dropoff_place_id = place.place_id;
          st.tour.dropoff_address = display;
        }
      }

      if (type === "dropoff") {
        st.tour.dropoff_place_id = place.place_id;
        st.tour.dropoff_address = display;
      }
    }

    if (tourPickupInput) {
      const ac = new google.maps.places.Autocomplete(tourPickupInput, options);
      ac.addListener("place_changed", () => storePlace(ac, tourPickupInput, "pickup"));
    }

    if (tourDropoffInput) {
      const ac = new google.maps.places.Autocomplete(tourDropoffInput, options);
      ac.addListener("place_changed", () => storePlace(ac, tourDropoffInput, "dropoff"));
    }
  }

  attachTourPlaces();

  function hydrateSelectedTourFromDom() {
    const st = ensureTourState();
    if (st.tour.tour_id) return;

    const selected =
      document.querySelector("[data-tour-card].is-selected") ||
      document.querySelector("[data-tour-select].is-selected") ||
      document.querySelector("[data-tour-id].is-selected") ||
      document.querySelector("[data-tour-card][data-tour-id]") ||
      document.querySelector("[data-tour-select][data-tour-id]") ||
      document.querySelector("[data-tour-id]");

    if (!selected) return;

    const data = extractTourData(selected);
    if (!data.tour_id) return;

    setSelectedTourState(data);
  }

  function validateTourStep2() {
    const st = ensureTourState();

    hydrateSelectedTourFromDom();
    syncTourModesFromDom();

    const dateVal = (tourDateInput?.value || "").trim();
    const timeVal = (tourTimeInput?.value || "").trim();

    if (!st.tour.tour_id) {
      console.warn("Tour validation failed: missing tour_id", { tour: st.tour });
      return { ok: false, msg: "Please choose a tour." };
    }

    if (!dateVal) return { ok: false, msg: "Please choose a tour date." };
    if (!timeVal) return { ok: false, msg: "Please choose a pickup time." };

    const pickupNeedsAddress =
      st.tour.pickup_mode === "athens_center" || st.tour.pickup_mode === "custom";

    if (pickupNeedsAddress && !st.tour.pickup_place_id && !(tourPickupInput?.value || "").trim()) {
      return { ok: false, msg: "Please choose a valid pickup address." };
    }

    if (st.tour.dropoff_mode !== "same_as_pickup") {
      const dropoffNeedsAddress =
        st.tour.dropoff_mode === "athens_center" || st.tour.dropoff_mode === "custom";

      if (dropoffNeedsAddress && !st.tour.dropoff_place_id && !(tourDropoffInput?.value || "").trim()) {
        return { ok: false, msg: "Please choose a valid dropoff address." };
      }
    }

    return { ok: true };
  }

  async function requestTourQuote() {
    const st = ensureTourState();
    hydrateSelectedTourFromDom();
    syncTourModesFromDom();

    const dateVal = (tourDateInput?.value || "").trim();
    const timeVal = (tourTimeInput?.value || "").trim();

    const pickup_datetime_iso = new Date(`${dateVal}T${timeVal}:00`).toISOString();
    st.tour.pickup_datetime_iso = pickup_datetime_iso;

    const payload = {
      service_type: "TOUR",
      tour_id: st.tour.tour_id,
      pickup_datetime_iso,
      passengers: st.tour.passengers,
      extra_hours: st.tour.extra_hours,

      pickup_mode: st.tour.pickup_mode,
      pickup_place_id: st.tour.pickup_place_id || "",
      pickup_address: st.tour.pickup_address || (tourPickupInput?.value || "").trim(),

      dropoff_mode: st.tour.dropoff_mode,
      dropoff_place_id:
        st.tour.dropoff_mode === "same_as_pickup"
          ? (st.tour.pickup_place_id || "")
          : (st.tour.dropoff_place_id || ""),
      dropoff_address:
        st.tour.dropoff_mode === "same_as_pickup"
          ? (st.tour.pickup_address || (tourPickupInput?.value || "").trim())
          : (st.tour.dropoff_address || (tourDropoffInput?.value || "").trim()),
    };

    const res = await fetch(TOUR_QUOTE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Tour quote request failed");
    }

    return res.json();
  }

  async function createTourHoldFromState() {
    const st = ensureTourState();
    syncTourModesFromDom();

    const payload = {
      service_type: "TOUR",
      tour_id: st.tour.tour_id,
      pickup_datetime_iso: st.tour.pickup_datetime_iso,

      passengers: st.tour.passengers,
      extra_hours: st.tour.extra_hours,

      pickup_mode: st.tour.pickup_mode,
      pickup_place_id: st.tour.pickup_place_id || "",
      pickup_address: st.tour.pickup_address || (tourPickupInput?.value || ""),

      dropoff_mode: st.tour.dropoff_mode,
      dropoff_place_id:
        st.tour.dropoff_mode === "same_as_pickup"
          ? (st.tour.pickup_place_id || "")
          : (st.tour.dropoff_place_id || ""),
      dropoff_address:
        st.tour.dropoff_mode === "same_as_pickup"
          ? (st.tour.pickup_address || (tourPickupInput?.value || ""))
          : (st.tour.dropoff_address || (tourDropoffInput?.value || "")),

      customer_first_name: st.tourContact.first_name || "",
      customer_last_name: st.tourContact.last_name || "",
      customer_email: st.tourContact.email || "",
      customer_phone: st.tourContact.phone || "",
      arrival: {
        flight_number: st.tour.arrival?.flight_number || "",
        vessel_name: st.tour.arrival?.vessel_name || "",
      },
    };

    const res = await fetch(TOUR_HOLD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Tour hold request failed");
    }

    return res.json();
  }

  async function createTourCheckout(hold_booking_id) {
    const res = await fetch(TOUR_CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hold_booking_id }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Tour checkout request failed");
    }

    return res.json();
  }

  const backTour2Btn = document.querySelector('[data-action="back-tour-2"]');
  const nextTour2Btn = document.querySelector('[data-action="next-tour-2"]');
  const backTour3Btn = document.querySelector('[data-action="back-tour-3"]');
  const nextTour3Btn = document.querySelector('[data-action="next-tour-3"]');
  const backTour4Btn = document.querySelector('[data-action="back-tour-4"]');
  const confirmTourBtn = document.querySelector('[data-action="confirm-tour"]');

  if (backTour2Btn) {
    backTour2Btn.addEventListener("click", function (e) {
      e.preventDefault();
      showTourStep(1);
    });
  }

  if (nextTour2Btn) {
    nextTour2Btn.addEventListener("click", async function (e) {
      e.preventDefault();

      console.log("Current booking state before Step 2 validation:", window.__VEIN_BOOKING__);

      const v = validateTourStep2();
      if (!v.ok) {
        alert(v.msg);
        return;
      }

      try {
        const quote = await requestTourQuote();
        const st = ensureTourState();
        st.tour.quote = quote;
        st.tourMaxReachedStep = Math.max(Number(st.tourMaxReachedStep || 1), 3);
        showTourStep(3);
      } catch (err) {
        console.error("TOUR QUOTE ERROR:", err);
        alert("Could not calculate tour quote:\n" + (err?.message || String(err)));
      }
    });
  }

  const tourFirstNameEl = document.querySelector('[data-field="tour.contact.first_name"]');
  const tourLastNameEl = document.querySelector('[data-field="tour.contact.last_name"]');
  const tourEmailEl = document.querySelector('[data-field="tour.contact.email"]');
  const tourPhoneEl = document.getElementById("tour_contact_phone");
  const tourTermsEl = document.getElementById("tour_accept_terms");
  const tourFlightEl = document.querySelector('[data-field="tour.arrival.flight_number"]');
  const tourShipEl = document.querySelector('[data-field="tour.arrival.vessel_name"]');

  function validateTourStep3() {
    const fn = (tourFirstNameEl?.value || "").trim();
    const ln = (tourLastNameEl?.value || "").trim();
    const em = (tourEmailEl?.value || "").trim();
    const ph = (tourPhoneEl?.value || "").trim();
    const termsOk = !!(tourTermsEl && tourTermsEl.checked);

    if (!fn || !ln) return { ok: false, msg: "Please enter first & last name." };
    if (!isValidEmail(em)) return { ok: false, msg: "Please enter a valid email." };
    if (!ph) return { ok: false, msg: "Please enter a phone number." };
    if (!termsOk) return { ok: false, msg: "Please accept the Terms & Conditions & Privacy Policy." };

    return { ok: true };
  }

  if (backTour3Btn) {
    backTour3Btn.addEventListener("click", function (e) {
      e.preventDefault();
      showTourStep(2);
    });
  }

  if (nextTour3Btn) {
    nextTour3Btn.addEventListener("click", function (e) {
      e.preventDefault();

      const v = validateTourStep3();
      if (!v.ok) {
        alert(v.msg);
        return;
      }

      const st = ensureTourState();
      st.tourContact.first_name = (tourFirstNameEl?.value || "").trim();
      st.tourContact.last_name = (tourLastNameEl?.value || "").trim();
      st.tourContact.email = (tourEmailEl?.value || "").trim();
      st.tourContact.phone = (tourPhoneEl?.value || "").trim();
      st.tour.arrival = {
        flight_number: (tourFlightEl?.value || "").trim(),
        vessel_name: (tourShipEl?.value || "").trim()
      };

      st.tourMaxReachedStep = Math.max(Number(st.tourMaxReachedStep || 1), 4);
      showTourStep(4);
    });
  }

  function updateTourReviewSummary() {
  const st = ensureTourState();
  const q = st.tour.quote || {};
  const breakdown = q.price_breakdown || {};

  const root = document.querySelector('[data-step="tour-4"]') || step4 || document;

  const setSummaryText = (summaryKey, value, fallback = "-") => {
    root.querySelectorAll(`[data-summary="${summaryKey}"]`).forEach((el) => {
      const v = (value || "").toString().trim();
      el.textContent = v ? v : fallback;
    });
  };

  const dateVal = (tourDateInput?.value || "").trim();
  const timeVal = (tourTimeInput?.value || "").trim();

  const effectiveDropoffMode =
    st.tour.dropoff_mode === "same_as_pickup" ? st.tour.pickup_mode : st.tour.dropoff_mode;

  const pickupText =
    st.tour.pickup_mode === "airport" || st.tour.pickup_mode === "piraeus_port"
      ? presetLabelForMode(st.tour.pickup_mode)
      : (st.tour.pickup_address || tourPickupInput?.value || "-");

  const dropoffText =
    st.tour.dropoff_mode === "same_as_pickup"
      ? pickupText
      : (
          effectiveDropoffMode === "airport" || effectiveDropoffMode === "piraeus_port"
            ? presetLabelForMode(effectiveDropoffMode)
            : (st.tour.dropoff_address || tourDropoffInput?.value || "-")
        );

  setSummaryText("tour.name", st.tour.tour_name || "-");
  setSummaryText("tour.duration", st.tour.duration || "-");
  setSummaryText("tour.datetime", formatDateTime(dateVal, timeVal));
  setSummaryText("tour.guests", String(st.tour.passengers || 1));
  setSummaryText("tour.extra_hours", String(st.tour.extra_hours || 0));

  setSummaryText("tour.pickup_mode", presetLabelForMode(st.tour.pickup_mode));
  setSummaryText("tour.pickup", pickupText);

  setSummaryText(
    "tour.dropoff_mode",
    st.tour.dropoff_mode === "same_as_pickup" ? "Same as Pickup" : presetLabelForMode(st.tour.dropoff_mode)
  );
  setSummaryText("tour.dropoff", dropoffText);

  setSummaryText("tour.first_name", st.tourContact.first_name || "-");
  setSummaryText("tour.last_name", st.tourContact.last_name || "-");
  setSummaryText("tour.email", st.tourContact.email || "-");
  setSummaryText("tour.phone", st.tourContact.phone || "-");

  setSummaryText("tour.total", q.price_total_eur != null ? `€${q.price_total_eur}` : "-");
  setSummaryText("tour.base_price", breakdown.base != null ? `€${breakdown.base}` : "-");
  setSummaryText("tour.extra_hours_total", breakdown.extra_hours_total != null ? `€${breakdown.extra_hours_total}` : "-");
  setSummaryText("tour.pickup_addon", breakdown.pickup_addon != null ? `€${breakdown.pickup_addon}` : "-");
  setSummaryText("tour.dropoff_addon", breakdown.dropoff_addon != null ? `€${breakdown.dropoff_addon}` : "-");

  const extraHours = num(st.tour.extra_hours);
  const extraHoursTotal = num(breakdown.extra_hours_total);
  const pickupAddon = num(breakdown.pickup_addon);
  const dropoffAddon = num(breakdown.dropoff_addon);

  toggleSummaryBlockBySummaryKey("tour.extra_hours", extraHours > 0);
  toggleSummaryBlockBySummaryKey("tour.extra_hours_total", extraHoursTotal > 0);
  toggleSummaryBlockBySummaryKey("tour.pickup_addon", pickupAddon > 0);
  toggleSummaryBlockBySummaryKey("tour.dropoff_addon", dropoffAddon > 0);

  console.log("SUMMARY HIDE CHECK", {
    extraHours,
    extraHoursTotal,
    pickupAddon,
    dropoffAddon
  });
}

  if (backTour4Btn) {
    backTour4Btn.addEventListener("click", function (e) {
      e.preventDefault();
      showTourStep(3);
    });
  }

  if (confirmTourBtn) {
    confirmTourBtn.addEventListener("click", async function (e) {
      e.preventDefault();

      const originalText = confirmTourBtn.textContent;

      try {
        confirmTourBtn.disabled = true;
        confirmTourBtn.style.opacity = "0.7";
        confirmTourBtn.textContent = "Processing...";

        const hold = await createTourHoldFromState();
        state().tour.hold = hold;

        const holdId = hold.hold_booking_id || hold.booking_id;
        if (!holdId) throw new Error("Tour hold created but hold_booking_id missing.");

        const checkout = await createTourCheckout(holdId);
        if (checkout && checkout.url) {
          window.location.href = checkout.url;
          return;
        }

        throw new Error("Tour checkout created but no URL returned.");
      } catch (err) {
        console.error("TOUR CONFIRM ERROR:", err);
        alert("Could not start tour checkout:\n" + (err?.message || String(err)));
      } finally {
        confirmTourBtn.disabled = false;
        confirmTourBtn.style.opacity = "";
        confirmTourBtn.textContent = originalText || "CONFIRM BOOKING";
      }
    });
  }

  let __tourItiInstance = null;

  function forceTourDropdownScrollable() {
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

  function initTourPhoneInputOnce() {
    const phoneInput = document.getElementById("tour_contact_phone");
    if (!phoneInput) return;
    if (!window.intlTelInput) return;
    if (__tourItiInstance) return;

    __tourItiInstance = window.intlTelInput(phoneInput, {
      initialCountry: "gr",
      separateDialCode: true,
      nationalMode: true,
      dropdownContainer: document.body
    });

    forceTourDropdownScrollable();
    phoneInput.addEventListener("open:countrydropdown", forceTourDropdownScrollable);

    document.addEventListener("wheel", (e) => {
      const inside = e.target.closest(".iti__country-list, .iti__dropdown-content, .iti__dropdown");
      if (inside) e.stopPropagation();
    }, { passive: true, capture: true });

    phoneInput.addEventListener("blur", function () {
      if (!phoneInput.value.trim()) return;
      const full = __tourItiInstance.getNumber();
      if (full) phoneInput.value = full;
    });
  }

  console.log("TOUR LOADED");
  console.log("tour step indicators:", document.querySelectorAll("[data-tour-step-indicator]").length);
  console.log("tour step lines:", document.querySelectorAll("[data-tour-step-line]").length);
  console.log("tour dropoff athens radios:", document.querySelectorAll('[data-tour-dropoff-mode="athens_center"]').length);
  console.log("tour dropoff same_as_pickup radios:", document.querySelectorAll('[data-tour-dropoff-mode="same_as_pickup"]').length);

  const st = ensureTourState();
  st.tourMaxReachedStep = Number(st.tourMaxReachedStep || 1);

  normalizeTourRadioSettings();
  bindTourCards();
  wireTourStepIndicatorClicks();
  applyTourDefaultRadios();
  syncTourModesFromDom();
  syncTourModeVisibility();
  showTourStep(Number(st.tourCurrentStep || 1));
});