document.addEventListener("DOMContentLoaded", function () {
  function state() {
    window.__VEIN_BOOKING__ = window.__VEIN_BOOKING__ || {};
    return window.__VEIN_BOOKING__;
  }

  function ensureTourState() {
    const st = state();

    st.tour = st.tour || {
      tour_id: "",
      tour_name: "",
      duration: "",
      passengers: 1,
      extra_hours: 0,
      pickup_datetime_iso: "",
      pickup_mode: "athens_center",
      pickup_place_id: "",
      pickup_address: "",
      dropoff_mode: "same_as_pickup",
      dropoff_place_id: "",
      dropoff_address: "",
      quote: null,
      hold: null,
    };

    st.tourContact = st.tourContact || {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
    };

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

  const TOUR_QUOTE_ENDPOINT = "https://vein-booking-api.vercel.app/api/quote";
  const TOUR_HOLD_ENDPOINT = "https://vein-booking-api.vercel.app/api/hold";
  const TOUR_CHECKOUT_ENDPOINT = "https://vein-booking-api.vercel.app/api/checkout";

  const step1 = document.querySelector('[data-step="tour-1"]');
  const step2 = document.querySelector('[data-step="tour-2"]');
  const step3 = document.querySelector('[data-step="tour-3"]');
  const step4 = document.querySelector('[data-step="tour-4"]');

  function updateTourStepIndicator(tourStepCurrent) {
    document.querySelectorAll("[data-tour-step-indicator]").forEach((stepEl) => {
      const stepNum = Number(stepEl.getAttribute("data-tour-step-indicator"));
      stepEl.classList.remove("is-completed", "is-active");

      if (stepNum < tourStepCurrent) stepEl.classList.add("is-completed");
      if (stepNum === tourStepCurrent) stepEl.classList.add("is-active");
    });

    document.querySelectorAll("[data-tour-step-line]").forEach((lineEl) => {
      const lineNum = Number(lineEl.getAttribute("data-tour-step-line"));
      lineEl.classList.remove("is-completed");
      if (tourStepCurrent > lineNum) lineEl.classList.add("is-completed");
    });
  }

  function showTourStep(n) {
    const st = ensureTourState();
    st.tourCurrentStep = n;

    if (step1) step1.style.display = n === 1 ? "block" : "none";
    if (step2) step2.style.display = n === 2 ? "block" : "none";
    if (step3) step3.style.display = n === 3 ? "block" : "none";
    if (step4) {
      step4.style.display = n === 4 ? "block" : "none";
      if (n === 4) updateTourReviewSummary();
    }

    updateTourStepIndicator(n);

    if (n === 3) setTimeout(initTourPhoneInputOnce, 50);
  }

  window.showTourStep = showTourStep;

  function bindTourCards() {
  document.querySelectorAll("[data-tour-select]").forEach((btn) => {
    btn.style.cursor = "pointer";

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const st = ensureTourState();

      st.tour.tour_id = btn.getAttribute("data-tour-id") || "";
      st.tour.tour_name = btn.getAttribute("data-tour-name") || "";
      st.tour.duration = btn.getAttribute("data-tour-duration") || "";

      document.querySelectorAll("[data-tour-select]").forEach((b) => {
        b.classList.remove("is-selected");
      });

      btn.classList.add("is-selected");

      showTourStep(2);
    });
  });
}

  function wireTourStepIndicatorClicks() {
    document.querySelectorAll("[data-tour-step-indicator]").forEach((stepEl) => {
      stepEl.style.cursor = "pointer";

      stepEl.addEventListener("click", function () {
        const st = ensureTourState();
        const targetStep = Number(stepEl.getAttribute("data-tour-step-indicator"));

        if (!st.tour.tour_id && targetStep > 1) return;
        if (targetStep < 1 || targetStep > 4) return;

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

  document.querySelectorAll('[data-counter]').forEach((btn) => {
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

  const pickupAddressWrap = document.querySelector('[data-tour-visible="pickup-address"]');
  const dropoffAddressWrap = document.querySelector('[data-tour-visible="dropoff-address"]');

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
      dropoffAddressWrap.style.display = st.tour.dropoff_mode === "same_as_pickup"
        ? "none"
        : (dropoffNeedsAddress ? "block" : "none");
    }

    if (st.tour.dropoff_mode === "same_as_pickup") {
      st.tour.dropoff_place_id = st.tour.pickup_place_id || "";
      st.tour.dropoff_address = st.tour.pickup_address || "";
    }
      const flightWrap = document.querySelector('[data-tour-visible="flight-field"]');
  const shipWrap = document.querySelector('[data-tour-visible="ship-field"]');

  if (flightWrap) {
    flightWrap.style.display = st.tour.pickup_mode === "airport" ? "block" : "none";
  }

  if (shipWrap) {
    shipWrap.style.display = st.tour.pickup_mode === "piraeus_port" ? "block" : "none";
  }
  }

  document.querySelectorAll("[data-tour-pickup-mode]").forEach((input) => {
    input.addEventListener("change", function () {
      if (!this.checked) return;
      const st = ensureTourState();
      st.tour.pickup_mode = this.getAttribute("data-tour-pickup-mode") || "athens_center";

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
      const st = ensureTourState();
      st.tour.dropoff_mode = this.getAttribute("data-tour-dropoff-mode") || "same_as_pickup";
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

  function validateTourStep2() {
    const st = ensureTourState();

    const dateVal = (tourDateInput?.value || "").trim();
    const timeVal = (tourTimeInput?.value || "").trim();

    if (!st.tour.tour_id) return { ok: false, msg: "Please choose a tour." };
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
  vessel_name: st.tour.arrival?.vessel_name || ""
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

      const v = validateTourStep2();
      if (!v.ok) {
        alert(v.msg);
        return;
      }

      try {
        const quote = await requestTourQuote();
        const st = ensureTourState();
        st.tour.quote = quote;
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

      showTourStep(4);
    });
  }

  function updateTourReviewSummary() {
    const st = ensureTourState();
    const q = st.tour.quote || {};
    const breakdown = q.price_breakdown || {};

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

    setText(document.querySelector('[data-summary="tour.name"]'), st.tour.tour_name || "-");
    setText(document.querySelector('[data-summary="tour.duration"]'), st.tour.duration || "-");
    setText(document.querySelector('[data-summary="tour.datetime"]'), formatDateTime(dateVal, timeVal));
    setText(document.querySelector('[data-summary="tour.guests"]'), String(st.tour.passengers || 1));
    setText(document.querySelector('[data-summary="tour.extra_hours"]'), String(st.tour.extra_hours || 0));

    setText(document.querySelector('[data-summary="tour.pickup_mode"]'), presetLabelForMode(st.tour.pickup_mode));
    setText(document.querySelector('[data-summary="tour.pickup"]'), pickupText);

    setText(
      document.querySelector('[data-summary="tour.dropoff_mode"]'),
      st.tour.dropoff_mode === "same_as_pickup" ? "Same as Pickup" : presetLabelForMode(st.tour.dropoff_mode)
    );
    setText(document.querySelector('[data-summary="tour.dropoff"]'), dropoffText);

    setText(document.querySelector('[data-summary="tour.first_name"]'), st.tourContact.first_name || "-");
    setText(document.querySelector('[data-summary="tour.last_name"]'), st.tourContact.last_name || "-");
    setText(document.querySelector('[data-summary="tour.email"]'), st.tourContact.email || "-");
    setText(document.querySelector('[data-summary="tour.phone"]'), st.tourContact.phone || "-");

    setText(document.querySelector('[data-summary="tour.total"]'), q.price_total_eur != null ? `€${q.price_total_eur}` : "-");

    if (breakdown) {
      setText(document.querySelector('[data-summary="tour.base_price"]'), breakdown.base != null ? `€${breakdown.base}` : "-");
      setText(document.querySelector('[data-summary="tour.extra_hours_total"]'), breakdown.extra_hours_total != null ? `€${breakdown.extra_hours_total}` : "-");
      setText(document.querySelector('[data-summary="tour.pickup_addon"]'), breakdown.pickup_addon != null ? `€${breakdown.pickup_addon}` : "-");
      setText(document.querySelector('[data-summary="tour.dropoff_addon"]'), breakdown.dropoff_addon != null ? `€${breakdown.dropoff_addon}` : "-");
    }
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

  ensureTourState();
  bindTourCards();
  syncTourModeVisibility();
  showTourStep(1);
});