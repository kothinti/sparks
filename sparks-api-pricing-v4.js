// Price Updater with Real-Time SignalR Updates
!(function () {
  "use strict";
  const e = {
    API_BASE_URL: "https://api.sparks.net",
    HUB_URL: "https://api.sparks.net/pricehub",
    PRODUCT_COLLECTIONS: {
      Running: "b9c7b12a-e92c-4429-a2e6-3a2d82595dcd",
      Rowing: "4359e877-9b1e-48b3-ba48-0232491e2c21",
    },
    GEO_API_URL: "https://get.geojs.io/v1/ip/country.json",
    DEBUG: !1,
  };
  window.priceUpdater = new (class {
    constructor() {
      ((this.connection = null),
        (this.priceElements = new Map()),
        (this.currentCurrency = "USD"),
        (this.productIds = []),
        (this.productCollectionId = null),
        (this.isCampPage = null),
        "loading" === document.readyState
          ? document.addEventListener("DOMContentLoaded", () => this.init())
          : this.init());
    }
    async init() {
      try {
        if (
          (this.showLoading(!0),
          this.detectPageType(),
          await this.detectCountry(),
          this.updateCurrency(),
          this.watchCurrencyChanges(),
          this.findProductCards(),
          0 === this.productIds.length)
        )
          return (
            e.DEBUG && console.log("No products found on page"),
            void this.showLoading(!1)
          );
        (await this.loadFromAPI(),
          await this.loadSignalR(),
          await this.connect(),
          this.showLoading(!1));
      } catch (e) {
        (console.error("Failed to initialize price updater:", e),
          this.showLoading(!1),
          setTimeout(() => this.init(), 5e3));
      }
    }
    detectPageType() {
      void 0 !== window.isCampPage &&
        ((this.isCampPage = window.isCampPage),
        (this.productCollectionId = e.PRODUCT_COLLECTIONS[this.isCampPage]),
        e.DEBUG &&
          (console.log("Page type detected:", this.isCampPage),
          console.log("Product collection ID:", this.productCollectionId)));
    }
    async detectCountry() {
      const t = localStorage.getItem("selectedCountry");
      if (null === t)
        try {
          const t = await fetch(e.GEO_API_URL);
          if (!t.ok) throw new Error("Geo-detection failed");
          const i = (await t.json()).country,
            s = "GB" === i ? "UK" : "US";
          localStorage.setItem("selectedCountry", s);
          const a = document.getElementById("country-select");
          (a && (a.value = s),
            e.DEBUG && console.log("Country detected:", i, "-> Using:", s));
        } catch (e) {
          (console.warn("Country detection failed, defaulting to US:", e),
            localStorage.setItem("selectedCountry", "US"));
          const t = document.getElementById("country-select");
          t && (t.value = "US");
        }
      else {
        const e = document.getElementById("country-select");
        e && (e.value = t);
      }
    }
    showLoading(e) {
      const t = document.querySelector(".loading-gif");
      t && (t.style.display = e ? "" : "none");
    }
    findProductCards() {
      const t = document.querySelectorAll(".api-camp[id]");
      ((this.productIds = Array.from(t)
        .map((e) => e.id)
        .filter((e) => e && this.isValidGuid(e))),
        e.DEBUG &&
          console.log(
            `Found ${this.productIds.length} products:`,
            this.productIds,
          ));
    }
    isDetailPage() {
      return void 0 !== window.isCampDetailPage && window.isCampDetailPage;
    }
    isValidGuid(e) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        e,
      );
    }
    async loadFromAPI() {
      if (!this.productCollectionId)
        throw new Error(
          'No product collection configured. Set window.isCampPage = "Running" or "Rowing"',
        );
      let t;
      if (this.isDetailPage() && 1 === this.productIds.length) {
        const i = this.productIds[0];
        ((t = `${e.API_BASE_URL}/api/v1/client/product-collection/${this.productCollectionId}/product/${i}`),
          e.DEBUG &&
            console.log("Fetching single product from optimized API:", t));
      } else
        ((t = `${e.API_BASE_URL}/api/v1/client/product-collection/${this.productCollectionId}`),
          e.DEBUG && console.log("Fetching collection from API:", t));
      const i = await fetch(t);
      if (!i.ok) throw new Error(`API returned ${i.status}: ${i.statusText}`);
      const s = await i.json();
      (e.DEBUG && console.log("Loaded data from API:", s),
        s.products &&
          s.products.forEach((e) => {
            e.sessions &&
              e.sessions.sort(
                (e, t) => new Date(e.start_date) - new Date(t.start_date),
              );
          }),
        this.displayProducts(s.products));
    }
    displayProducts(e) {
      e &&
        Array.isArray(e) &&
        e.forEach((e) => {
          this.displayProduct(e);
        });
    }
    displayProduct(e) {
      const t = e.product_id || e.productId,
        i = document.querySelector(`.api-camp[id="${t}"]`);
      if (!i) return;
      const s = i.querySelector(".camps-api-data");
      s &&
        (e.name &&
          e.name.includes("Winter") &&
          (console.log("=== RAW PRODUCT DATA (Winter) ==="),
          console.log("Product name:", e.name),
          console.log("Raw prices array:", e.prices),
          console.log("Raw electives array:", e.electives)),
        (s.innerHTML = ""),
        this.updateIntroText(i, e),
        this.updatePurchaseButton(i, e),
        void 0 !== window.isCampDetailPage && window.isCampDetailPage
          ? this.displayDetailPage(s, e, i)
          : (this.displaySessions(s, e),
            this.displayEarlyAccess(i, e),
            this.displayPrices(s, e)));
    }
    displayDetailPage(e, t, i) {
      const s = t.sessions || [],
        a = t.prices || [],
        n = t.electives || [],
        c = a.some((e) => !(e.name || "").toLowerCase().includes("deposit"));
      n.some(
        (e) =>
          e.elective_type_mapping &&
          e.elective_type_mapping.toLowerCase().includes("overnight"),
      ) &&
        !c &&
        console.warn(
          "Product has overnight electives but no base prices - detail page will not display electives:",
          t.name,
        );
      const r = a
          .filter((e) => {
            const t = (e.name || "").toLowerCase();
            return !t.includes("deposit") && !t.includes("waitlist");
          })
          .map((e) => ({
            ...e,
            grouping: e.grouping,
            sessionStartDate: e.session_start_date || e.sessionStartDate,
            sessionEndDate: e.session_end_date || e.sessionEndDate,
            nextTierPrice: e.next_tier_price || e.nextTierPrice,
            slotsRemaining: e.slots_remaining_in_tier || e.slotsRemainingInTier,
            totalTierCapacity: e.total_tier_capacity || e.totalTierCapacity,
          })),
        o = n
          .filter(
            (e) =>
              e.elective_type_mapping &&
              e.elective_type_mapping.toLowerCase().includes("overnight"),
          )
          .map((e) => ({
            ...e,
            electiveTypeMapping:
              e.elective_type_mapping || e.electiveTypeMapping,
            sessionStartDate: e.session_start_date || e.sessionStartDate,
            sessionEndDate: e.session_end_date || e.sessionEndDate,
            nextTierPrice: e.next_tier_price || e.nextTierPrice,
            slotsRemaining: e.slots_remaining_in_tier || e.slotsRemainingInTier,
            totalTierCapacity: e.total_tier_capacity || e.totalTierCapacity,
          })),
        l = i.querySelector(".camp-card_grid, .camps-list_card-grid"),
        d = l ? l.children[1] : null,
        p = s.length > 1,
        u = o.length > 0 && c;
      let m = 4,
        h = [];
      if (p && !u) {
        if (
          ((h = this.displayMultipleSessionsNoGrouping(s, r)), 0 === h.length)
        )
          return void this.displayEarlyAccess(i, t);
        m = 4;
      } else if (p && u) {
        if (
          ((h = this.displayMultipleSessionsWithOvernight(s, r, o)),
          0 === h.length)
        )
          return void this.displayEarlyAccess(i, t);
        m = 4;
      } else if (1 === s.length && u) {
        const e = this.displaySingleSessionWithOvernight(s[0], r, o);
        e
          ? ((h = [e]), (m = 3))
          : ((h = [this.displaySingleSessionSimple(s[0], r)]), (m = 3));
      } else {
        if (!(s.length >= 1)) return void this.displayEarlyAccess(i, t);
        {
          const e = this.displaySingleSessionSimple(s[0], r);
          if (!e) return void this.displayEarlyAccess(i, t);
          ((h = [e]), (m = 3));
        }
      }
      if (l && e) {
        const t = Array.from(l.children).indexOf(e.parentElement || e);
        (h.forEach((e, i) => {
          if (!e) return;
          const s = document.createElement("div");
          s.innerHTML = e;
          const a = s.firstElementChild;
          a &&
            (t >= 0
              ? l.insertBefore(a, l.children[t + i + 1])
              : l.appendChild(a));
        }),
          e.remove(),
          3 === m
            ? (l.classList.add("is-3-cols"), d && l.appendChild(d))
            : l.classList.remove("is-3-cols"));
      }
      this.displayEarlyAccess(i, t);
    }
    updateIntroText(e, t) {
      if (!("JoinWaitlist" === t.purchase_button_state)) return;
      const i = e.querySelectorAll("p.camp-intro-text");
      i.forEach((e) => {
        e.textContent =
          "This program is currently full. Join the waitlist to be notified if a spot becomes available.";
      });
    }
    updatePurchaseButton(productCard, product) {
      const buttonState =
        product.purchase_button_state || product.purchaseButtonState;
    
      const alumniAccess =
        product.alumni_access || product.alumniAccess;
    
      const isAlumniRegistration =
        buttonState === "Register" &&
        alumniAccess?.active === true;
    
      const applyButtons =
        productCard.querySelectorAll("a.btn-apply-now");
    
      applyButtons.forEach((applyButton) => {
        const wrapper = applyButton.parentElement;
    
        const buttonContainer =
          wrapper?.classList.contains("btn-apply-now")
            ? wrapper
            : applyButton;
    
        if (!buttonState || buttonState === "None") {
          buttonContainer.style.display = "none";
          return;
        }
    
        buttonContainer.style.display = "";
    
        const buttonTextMap = {
          Register: "Register Now!",
          Apply: "Apply Now!",
          JoinWaitlist: "Join Waitlist",
          ReserveSlot: "Reserve Slot",
        };
    
        applyButton.textContent = isAlumniRegistration
          ? "Alumni Registration Open"
          : buttonTextMap[buttonState] || buttonState;
      });
    }
    displaySessions(e, t) {
      const i = t.sessions || [],
        s = t.prices || [],
        a = document.createElement("div");
      if (
        ((a.className = "camps-listing-label"),
        (a.textContent = "DATES"),
        e.appendChild(a),
        0 === i.length)
      ) {
        const t = new Date().getFullYear() + 1,
          i = document.createElement("div");
        ((i.className = "dates-and-cost"),
          (i.style.cssText = "font-size:1.25rem;color:#001b41;font-weight:600"),
          (i.textContent = `Sign-Up for ${t} Early Access!`),
          e.appendChild(i));
      } else
        i.forEach((t) => {
          const i = this.formatDate(t.start_date || t.startDate, "MMM-DD"),
            a = this.formatDate(t.end_date || t.endDate, "MMM-DD, YYYY"),
            n = s.length
              ? (t.inventory_state || t.inventoryState || "").toLowerCase()
              : "",
            c = document.createElement("div");
          ((c.className = "dates-and-cost"),
            (c.innerHTML = `\n                        <div class="camp-dates-card flex">\n                            <div class="event-start-date">${i}</div>\n                            <div class="camps-date">&nbsp;-&nbsp;</div>\n                            <div class="event-end-date">${a}</div>\n                            ${n ? `<div class="inventory_state-${n}"></div>` : ""}\n                        </div>\n                    `),
            e.appendChild(c));
        });
    }
    displayEarlyAccess(e, t) {
      const i = t.sessions || [],
        s = t.prices || [],
        a = e.querySelectorAll(".get-early-access");
      if (a.length > 0) {
        const e = 0 === s.length || 0 === i.length;
        a.forEach((t) => {
          t.style.display = e ? "inline-block" : "none";
        });
      }
    }
    displayPrices(e, t) {
      if (
        (t.electives || []).some(
          (e) =>
            e.elective_type_mapping &&
            e.elective_type_mapping.toLowerCase().includes("overnight"),
        )
      )
        this.displayElectivePrices(e, t);
      else {
        let i = t.prices || [];
        if (
          ((i = i.map((e) => ({
            ...e,
            currencyCode: e.currency_code || e.currencyCode,
            discountPrice: e.discount_price || e.discountPrice,
            priceId: e.product_price_id || e.priceId,
          }))),
          (i = i.filter((e) => {
            const t = (e.name || "").toLowerCase();
            return (
              e.currencyCode === this.currentCurrency &&
              !t.includes("deposit") &&
              !t.includes("waitlist")
            );
          })),
          0 === i.length)
        )
          return;
        const s = document.createElement("div");
        ((s.className = "camps-listing-label"),
          (s.textContent = "COST"),
          e.appendChild(s));
        this.groupPricesByName(i).forEach((i) => {
          this.displayPriceRange(e, i, t.product_id);
        });
      }
    }
    displayElectivePrices(e, t) {
      const i = t.electives || [],
        s = t.prices || [],
        a = this.getCurrencySymbol(),
        n = s
          .filter((e) => {
            const t = (e.name || "").toLowerCase();
            return (
              (e.currency_code || e.currencyCode) === this.currentCurrency &&
              !t.includes("deposit") &&
              !t.includes("waitlist")
            );
          })
          .map((e) => e.price);
      if (0 === n.length)
        return void console.warn(
          "Product has overnight electives but no day prices - skipping elective display:",
          t.name,
        );
      const c = document.createElement("div");
      ((c.className = "camps-listing-label"),
        (c.textContent = "COST"),
        e.appendChild(c));
      const r = Math.min(...n),
        o = Math.max(...n),
        l = document.createElement("div");
      ((l.className = "camp-prices"),
        l.setAttribute("data-product-id", t.product_id),
        (l.innerHTML =
          r === o
            ? `\n                    <div class="camps-actual-cost">${a}${this.formatPrice(r)}</div>\n                `
            : `\n                    <div class="camps-actual-cost">${a}${this.formatPrice(r)} - ${a}${this.formatPrice(o)}</div>\n                `),
        e.appendChild(l));
      const d = document.createElement("div");
      ((d.className = "camps-listing-label"),
        (d.textContent = "Day Campers"),
        e.appendChild(d));
      const p = i.filter(
        (e) =>
          e.elective_type_mapping &&
          e.elective_type_mapping.toLowerCase().includes("overnight") &&
          (e.currency_code || e.currencyCode) === this.currentCurrency,
      );
      if (p.length > 0) {
        const i = p.map((e) => e.price),
          s = r + Math.min(...i),
          n = o + Math.max(...i),
          c = document.createElement("div");
        ((c.className = "camp-prices"),
          c.setAttribute("data-product-id", t.product_id),
          (c.innerHTML =
            s === n
              ? `\n                        <div class="camps-actual-cost">${a}${this.formatPrice(s)}</div>\n                    `
              : `\n                        <div class="camps-actual-cost">${a}${this.formatPrice(s)} - ${a}${this.formatPrice(n)}</div>\n                    `),
          e.appendChild(c));
        const l = document.createElement("div");
        ((l.className = "camps-listing-label"),
          (l.textContent = "Overnight Campers"),
          e.appendChild(l));
      }
    }
    groupPricesByName(e) {
      const t = {
        deposit: { name: "", prices: [], priceIds: [] },
        regular: { name: "", prices: [], priceIds: [] },
      };
      e.forEach((e) => {
        const i = e.name || "Price";
        if (i.toLowerCase().includes("deposit"))
          ((t.deposit.name = i),
            t.deposit.prices.push(e.price),
            t.deposit.priceIds.push(e.priceId));
        else {
          if (!t.regular.name) {
            const e = i.match(/\d{4}/);
            t.regular.name = e ? e[0] : i;
          }
          (t.regular.prices.push(e.price), t.regular.priceIds.push(e.priceId));
        }
      });
      const i = [];
      return (
        t.regular.prices.length > 0 &&
          i.push({
            name: t.regular.name,
            minPrice: Math.min(...t.regular.prices),
            maxPrice: Math.max(...t.regular.prices),
            priceIds: t.regular.priceIds,
          }),
        i
      );
    }
    displayPriceRange(e, t, i) {
      const s = this.getCurrencySymbol(),
        a = `${s}${this.formatPrice(t.minPrice)}`,
        n = `${s}${this.formatPrice(t.maxPrice)}`,
        c = document.createElement("div");
      ((c.className = "camp-prices"),
        c.setAttribute("data-product-id", i),
        c.setAttribute("data-currency-code", this.currentCurrency),
        t.priceIds.length > 0 &&
          c.setAttribute("data-price-ids", t.priceIds.join(",")),
        t.minPrice === t.maxPrice
          ? (c.innerHTML = `\n                    <div class="camps-actual-cost">${a}</div>\n                `)
          : (c.innerHTML = `\n                    <div class="camps-actual-cost">${a} - ${n}</div>\n                `),
        e.appendChild(c),
        t.priceIds.forEach((e) => {
          (this.priceElements.has(e) || this.priceElements.set(e, []),
            this.priceElements.get(e).push(c));
        }));
    }
    displayPrice(e, t, i) {
      const s = this.getCurrencySymbol(),
        a = `${s}${this.formatPrice(t.price)}`,
        n = document.createElement("div");
      ((n.className = "camp-prices"),
        n.setAttribute("data-product-id", i),
        t.priceId && n.setAttribute("data-product-price-id", t.priceId),
        n.setAttribute("data-currency-code", t.currencyCode));
      const c = t.discountPrice;
      if (c && c < t.price) {
        const e = `${s}${this.formatPrice(c)}`;
        n.innerHTML = `\n                    <div class="camps-actual-cost" style="text-decoration: line-through;color:#666565">${a}</div>\n                    <div class="camps-date">&nbsp;</div>\n                    <div class="camps-discounted-cost">${e}</div>\n                `;
      } else
        n.innerHTML = `\n                    <div class="camps-actual-cost">${a}</div>\n                `;
      e.appendChild(n);
      const r = document.createElement("div");
      if (
        ((r.className = "camps-listing-label"),
        (r.textContent = t.name),
        e.appendChild(r),
        t.priceId)
      ) {
        const e = t.priceId;
        (this.priceElements.has(e) || this.priceElements.set(e, []),
          this.priceElements.get(e).push(n));
      }
    }
    formatDate(e, t) {
      if (!e) return "";
      const [i] = e.split("T"),
        [s, a, n] = i.split("-").map(Number),
        c = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ],
        r = this.getDaySuffix(n);
      switch (t) {
        case "MMM-DD":
          return `${c[a - 1]} ${n}${r}`;
        case "MMM-DD, YYYY":
          return `${c[a - 1]} ${n}${r}, ${s}`;
        default:
          return e;
      }
    }
    getDaySuffix(e) {
      if (e >= 11 && e <= 13) return "th";
      switch (e % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    }
    updateCurrency() {
      const e = localStorage.getItem("selectedCountry");
      this.currentCurrency = "UK" === e ? "GBP" : "USD";
    }
    watchCurrencyChanges() {
      const e = document.getElementById("country-select");
      e &&
        e.addEventListener("change", async () => {
          (this.updateCurrency(),
            this.showLoading(!0),
            await this.loadFromAPI(),
            this.showLoading(!1));
        });
    }
    getCurrencySymbol() {
      return "GBP" === this.currentCurrency ? "£" : "$";
    }
    formatPrice(e) {
      return parseFloat(e).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    async loadSignalR() {
      if ("undefined" == typeof signalR)
        return new Promise((e, t) => {
          const i = document.createElement("script");
          ((i.src =
            "https://cdn.jsdelivr.net/npm/@microsoft/signalr@latest/dist/browser/signalr.min.js"),
            (i.onload = e),
            (i.onerror = t),
            document.head.appendChild(i));
        });
    }
    async connect() {
      try {
        ((this.connection = new signalR.HubConnectionBuilder()
          .withUrl(e.HUB_URL)
          .withAutomaticReconnect()
          .configureLogging(
            e.DEBUG ? signalR.LogLevel.Debug : signalR.LogLevel.Error,
          )
          .build()),
          this.connection.on("PriceUpdated", (e) => {
            this.updatePrice(e);
          }),
          this.connection.on("TierChanged", (t) => {
            e.DEBUG && console.log("Tier changed:", t);
          }),
          this.connection.onreconnected(() => {
            (e.DEBUG && console.log("Reconnected to price hub"),
              this.connection.invoke("JoinPriceGroup"));
          }),
          await this.connection.start(),
          await this.connection.invoke("JoinPriceGroup"),
          e.DEBUG &&
            console.log("Connected to SignalR for real-time price updates"));
      } catch (e) {
        console.error("SignalR connection failed:", e);
      }
    }
    updatePrice(t) {
      const {
        ProductVariantId: i,
        ProductPriceId: s,
        CurrentPrice: a,
        DiscountPrice: n,
        CurrencyCode: c,
        TierName: r,
        InventoryRemaining: o,
        PercentageFilled: l,
        SlotsRemainingInTier: d,
        TotalTierCapacity: p,
      } = t;
      if (c && c !== this.currentCurrency) return;
      const u = s,
        m = this.priceElements.get(u);
      m && 0 !== m.length
        ? (m.forEach((e) => {
            (this.setPriceDisplay(e, a, n),
              r && e.setAttribute("data-current-tier", r),
              void 0 !== o && e.setAttribute("data-inventory", o),
              void 0 !== l && e.setAttribute("data-percent-filled", l),
              void 0 !== d &&
                void 0 !== p &&
                this.updateDetailPageSlots(e, d, p));
          }),
          e.DEBUG && console.log("Price updated via SignalR:", t))
        : e.DEBUG && console.log("No elements found for price update:", s);
    }
    updateDetailPageSlots(t, i, s) {
      let a = t.closest(".card-right-border") || t.closest('[class*="card"]');
      if (!a) return;
      const n = a.querySelector(".slots-availability");
      if (n) {
        const e = this.calculateInventoryWidth(i, s);
        ((n.style.width = `${e}%`),
          n.classList.add("price-updated"),
          setTimeout(() => {
            n.classList.remove("price-updated");
          }, 300));
      }
      const c = a.querySelector(".camps-card_small-text");
      (c &&
        ((c.textContent = this.getSlotsText(i)),
        (c.className = "camps-card_small-text"),
        i <= 5 && c.classList.add("is-color-red"),
        c.classList.add("price-updated"),
        setTimeout(() => {
          c.classList.remove("price-updated");
        }, 300)),
        e.DEBUG &&
          console.log("Updated detail page slots:", {
            slotsRemaining: i,
            totalCapacity: s,
            progressBar: !!n,
            slotText: !!c,
          }));
    }
    setPriceDisplay(e, t, i) {
      const s = this.getCurrencySymbol(),
        a = `${s}${this.formatPrice(t)}`,
        n = e.querySelector(".camps-actual-cost"),
        c = e.querySelector(".camps-discounted-cost");
      if (i && i < t) {
        const e = `${s}${this.formatPrice(i)}`;
        if (
          (n &&
            ((n.textContent = a),
            (n.style.textDecoration = "line-through"),
            (n.style.color = "#666565")),
          c)
        )
          ((c.textContent = e), (c.style.display = ""));
        else if (n) {
          const t = n.parentElement;
          if (!t.querySelector(".camps-date")) {
            const e = document.createElement("div");
            ((e.className = "camps-date"),
              (e.innerHTML = "&nbsp;"),
              t.appendChild(e));
          }
          const i = document.createElement("div");
          ((i.className = "camps-discounted-cost"),
            (i.textContent = e),
            t.appendChild(i));
        }
      } else
        (n &&
          ((n.textContent = a),
          (n.style.textDecoration = ""),
          (n.style.color = "")),
          c && (c.style.display = "none"));
      (e.classList.add("price-updated"),
        setTimeout(() => {
          e.classList.remove("price-updated");
        }, 300));
    }
    displaySingleSessionSimple(e, t) {
      if (!e) return "";
      const i = t.find((e) => {
        const t = (e.name || "").toLowerCase();
        return !t.includes("deposit") && !t.includes("waitlist");
      });
      if (!i) return "";
      const s = this.getCurrencySymbol(),
        a = `${s}${this.formatPrice(i.price)}`,
        n = "Waitlist" === e.inventory_state,
        c =
          i.nextTierPrice && !n
            ? `${s}${this.formatPrice(i.nextTierPrice)}`
            : null;
      return `\n                <div class="card-right-border">\n                    <div class="camps-list_card-label">DATES</div>\n                    <div class="camp-card_value">${this.formatDate(e.start_date, "MMM-DD")} - ${this.formatDate(e.end_date, "MMM-DD, YYYY")}</div>\n                    <div class="spacer-small"></div>\n                    <div class="camps-list_card-label">PRICE</div>\n                    <div class="camp-card_price-card">\n                        <div class="price-card_set">\n                            <div class="camp-card_price">${a}</div>\n                        </div>\n                        ${c ? `<div class="camps-list_card-label">NEXT PRICE: ${c}</div>` : ""}\n                    </div>\n                    ${n ? "" : `\n                    <div class="slots-availability-base">\n                        <div class="slots-availability" style="width: ${this.calculateInventoryWidth(i.slotsRemaining || e.inventory_remaining, i.totalTierCapacity || i.total_tier_capacity)}%"></div>\n                    </div>\n                    <div class="camps-card_small-text ${this.getSlotsWarningClass(i.slotsRemaining)}">${this.getSlotsText(i.slotsRemaining || e.inventory_remaining)}</div>\n                    `}\n                </div>\n            `;
    }
    displaySingleSessionWithOvernight(e, t, i) {
      if (!e || !t || 0 === t.length) return "";
      const s = this.getCurrencySymbol(),
        a =
          t.find(
            (t) =>
              t.sessionStartDate &&
              new Date(t.sessionStartDate).getTime() ===
                new Date(e.start_date).getTime(),
          ) || t[0];
      if (!a) return "";
      const n =
        i && i.length > 0
          ? i.find(
              (t) =>
                t.sessionStartDate &&
                new Date(t.sessionStartDate).getTime() ===
                  new Date(e.start_date).getTime(),
            ) || i[0]
          : null;
      if (!n) return "";
      const c = a.price + n.price,
        r = a.totalTierCapacity || a.total_tier_capacity,
        o = a.slotsRemaining || e.inventory_remaining,
        l = "Waitlist" === e.inventory_state;
      return `\n                <div class="card-right-border">\n                    <div class="camps-list_card-label">DATES</div>\n                    <div class="camp-card_value">${this.formatDate(e.start_date, "MMM-DD")} - ${this.formatDate(e.end_date, "MMM-DD, YYYY")}</div>\n                    ${l ? "" : `\n                    <div class="slots-availability-base">\n                        <div class="slots-availability" style="width: ${this.calculateInventoryWidth(o, r)}%"></div>\n                    </div>\n                    <div class="camps-card_small-text">${this.getSlotsText(o)}</div>\n                    `}\n                    <div class="spacer-small"></div>\n                    <div class="camps-list_card-label">PRICE</div>\n                    <div class="camp-card_price-card">\n                        <div class="price-card_set">\n                            <div class="camp-card_price">${s}${this.formatPrice(c)}</div>\n                        </div>\n                    </div>\n                    <div class="text-size-small">for Overnight Campers</div>\n                    <div class="spacer-tiny"></div>\n                    <div class="camp-card_price-card">\n                        <div class="price-card_set">\n                            <div class="camp-card_price">${s}${this.formatPrice(a.price)}</div>\n                        </div>\n                    </div>\n                    <div class="text-size-small">for Day Campers</div>\n                </div>\n            `;
    }
    displayMultipleSessionsNoGrouping(e, t) {
      const i = this.getCurrencySymbol(),
        s = [];
      return (
        e.forEach((a, n) => {
          const c = n + 1;
          let r = t
            .filter(
              (e) =>
                e.sessionStartDate &&
                new Date(e.sessionStartDate).getTime() ===
                  new Date(a.start_date).getTime(),
            )
            .find((e) => {
              const t = (e.name || "").toLowerCase();
              return !t.includes("deposit") && !t.includes("waitlist");
            });
          !r && t[n] && (r = t[n]);
          const o = "Waitlist" === a.inventory_state,
            l =
              r.nextTierPrice && !o
                ? `${i}${this.formatPrice(r.nextTierPrice)}`
                : null;
          r &&
            s.push(
              `\n                        <div class="${n < e.length - 1 ? "card-right-border" : ""}">\n                            <div class="camps-list_card-label">SESSION ${c} DATES</div>\n                            <div class="camp-card_value">${this.formatDate(a.start_date, "MMM-DD")} - ${this.formatDate(a.end_date, "MMM-DD, YYYY")}</div>\n                            <div class="spacer-small"></div>\n                            <div class="camps-list_card-label">SESSION ${c} PRICE</div>\n                            <div class="camp-card_price-card">\n                                <div class="price-card_set">\n                                    <div class="camp-card_price">${i}${this.formatPrice(r.price)}</div>\n                                </div>\n                                ${l ? `<div class="camps-list_card-label">NEXT PRICE: ${l}</div>` : ""}\n                            </div>\n                            ${o ? "" : `\n                            <div class="slots-availability-base">\n                                <div class="slots-availability" style="width: ${this.calculateInventoryWidth(r.slotsRemaining || a.inventory_remaining, r.totalTierCapacity || r.total_tier_capacity)}%"></div>\n                            </div>\n                            <div class="camps-card_small-text ${this.getSlotsWarningClass(r.slotsRemaining)}">${this.getSlotsText(r.slotsRemaining || a.inventory_remaining)}</div>\n                            `}\n                        </div>\n                    `,
            );
        }),
        s
      );
    }
    displayMultipleSessionsWithOvernight(e, t, i) {
      if (!t || 0 === t.length) return [];
      const s = this.getCurrencySymbol(),
        a = [];
      return (
        e.forEach((n, c) => {
          const r = c + 1;
          let o = t.find(
            (e) =>
              e.sessionStartDate &&
              new Date(e.sessionStartDate).getTime() ===
                new Date(n.start_date).getTime(),
          );
          if ((!o && t[c] && (o = t[c]), !o)) return;
          const l =
              i && i.length > 0
                ? i.find(
                    (e) =>
                      e.sessionStartDate &&
                      new Date(e.sessionStartDate).getTime() ===
                        new Date(n.start_date).getTime(),
                  ) || i[0]
                : null,
            d = l ? o.price + l.price : null,
            p = o.totalTierCapacity || o.total_tier_capacity,
            u = o.slotsRemaining || n.inventory_remaining,
            m = "Waitlist" === n.inventory_state;
          a.push(
            `\n                    <div class="${c < e.length - 1 ? "card-right-border" : ""}">\n                        <div class="camps-list_card-label">SESSION ${r} DATES</div>\n                        <div class="camp-card_value">${this.formatDate(n.start_date, "MMM-DD")} - ${this.formatDate(n.end_date, "MMM-DD, YYYY")}</div>\n                        ${m ? "" : `\n                        <div class="slots-availability-base">\n                            <div class="slots-availability" style="width: ${this.calculateInventoryWidth(u, p)}%"></div>\n                        </div>\n                        <div class="camps-card_small-text">${this.getSlotsText(u)}</div>\n                        `}\n                        <div class="spacer-small"></div>\n                        <div class="camps-list_card-label">SESSION ${r} PRICE</div>\n                        ${d ? `\n                            <div class="camp-card_price-card">\n                                <div class="price-card_set">\n                                    <div class="camp-card_price">${s}${this.formatPrice(d)}</div>\n                                </div>\n                            </div>\n                            <div class="text-size-small">for Overnight Campers</div>\n                            <div class="spacer-tiny"></div>\n                        ` : ""}\n                        <div class="camp-card_price-card">\n                            <div class="price-card_set">\n                                <div class="camp-card_price">${s}${this.formatPrice(o.price)}</div>\n                            </div>\n                        </div>\n                        <div class="text-size-small">for Day Campers</div>\n                    </div>\n                `,
          );
        }),
        a
      );
    }
    calculateInventoryWidth(e, t = null) {
      if (t && t > 0) {
        const i = t - e;
        return Math.min(100, Math.max(0, (i / t) * 100));
      }
      return Math.min(100, (e / 50) * 100);
    }
    getSlotsWarningClass(e) {
      return e && e <= 5 ? "is-color-red" : "";
    }
    getSlotsText(e) {
      return e > 5
        ? "*5+ slot(s) remaining at this price"
        : `*${e} slot(s) remaining at this price`;
    }
  })();
})();
