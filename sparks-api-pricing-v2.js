(function () {
    'use strict';

    const CONFIG = {
        // API base URL for product data
        API_BASE_URL: 'https://api.sparks.net',

        // SignalR hub URL for real-time price updates
        HUB_URL: 'https://api.sparks.net/pricehub',

        // Product collection IDs mapped to page types
        PRODUCT_COLLECTIONS: {
            'Running': 'b9c7b12a-e92c-4429-a2e6-3a2d82595dcd',
            'Rowing': '4359e877-9b1e-48b3-ba48-0232491e2c21'
        },

        // Geo-detection API for first-time visitors
        GEO_API_URL: 'https://get.geojs.io/v1/ip/country.json',

        // Debug mode - set to false in production
        DEBUG: false
    };

    class PriceUpdater {
        constructor() {
            this.connection = null;
            this.priceElements = new Map();
            this.currentCurrency = 'USD'; // Default currency
            this.productIds = [];
            this.productCollectionId = null;
            this.isCampPage = null;

            // Initialize on DOM ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        async init() {
            try {
                // Show loading state
                this.showLoading(true);

                // Detect page type (checks global variable set in Webflow)
                this.detectPageType();

                // Detect country if first-time visitor
                await this.detectCountry();

                // Get current currency from localStorage
                this.updateCurrency();

                // Watch for currency changes
                this.watchCurrencyChanges();

                // Find all product cards on the page
                this.findProductCards();

                if (this.productIds.length === 0) {
                    if (CONFIG.DEBUG) {
                        console.log('No products found on page');
                    }
                    this.showLoading(false);
                    return;
                }

                // Load initial product data from API
                await this.loadFromAPI();

                // Load SignalR library
                await this.loadSignalR();

                // Connect to SignalR hub for real-time price updates
                await this.connect();

                // Hide loading state
                this.showLoading(false);

            } catch (error) {
                console.error('Failed to initialize price updater:', error);
                this.showLoading(false);
                // Retry after 5 seconds
                setTimeout(() => this.init(), 5000);
            }
        }

        detectPageType() {
            // Check if global variable window.isCampPage is defined in Webflow
            // Must be set before this script loads: window.isCampPage = "Running" or "Rowing"
            if (typeof window.isCampPage !== 'undefined') {
                this.isCampPage = window.isCampPage;
                this.productCollectionId = CONFIG.PRODUCT_COLLECTIONS[this.isCampPage];

                if (CONFIG.DEBUG) {
                    console.log('Page type detected:', this.isCampPage);
                    console.log('Product collection ID:', this.productCollectionId);
                }
            }
        }

        async detectCountry() {
            // Check if country is already stored
            const storedCountry = localStorage.getItem('selectedCountry');

            if (storedCountry === null) {
                try {
                    // Detect country using geo IP service
                    const response = await fetch(CONFIG.GEO_API_URL);

                    if (!response.ok) {
                        throw new Error('Geo-detection failed');
                    }

                    const data = await response.json();
                    const detectedCountry = data.country;
                    const selectedCountry = detectedCountry === 'GB' ? 'UK' : 'US';

                    // Save to localStorage
                    localStorage.setItem('selectedCountry', selectedCountry);

                    // Update country selector if it exists
                    const countrySelect = document.getElementById('country-select');
                    if (countrySelect) {
                        countrySelect.value = selectedCountry;
                    }

                    if (CONFIG.DEBUG) {
                        console.log('Country detected:', detectedCountry, '-> Using:', selectedCountry);
                    }
                } catch (error) {
                    // If geo-detection fails, default to US
                    console.warn('Country detection failed, defaulting to US:', error);
                    localStorage.setItem('selectedCountry', 'US');

                    const countrySelect = document.getElementById('country-select');
                    if (countrySelect) {
                        countrySelect.value = 'US';
                    }
                }
            } else {
                // Country already stored, update selector to match
                const countrySelect = document.getElementById('country-select');
                if (countrySelect) {
                    countrySelect.value = storedCountry;
                }
            }
        }

        showLoading(show) {
            const loadingGif = document.querySelector('.loading-gif');
            if (loadingGif) {
                loadingGif.style.display = show ? '' : 'none';
            }
        }

        findProductCards() {
            // Find all .api-camp elements with IDs
            const productCards = document.querySelectorAll('.api-camp[id]');
            this.productIds = Array.from(productCards)
                .map(card => card.id)
                .filter(id => id && this.isValidGuid(id));

            if (CONFIG.DEBUG) {
                console.log(`Found ${this.productIds.length} products:`, this.productIds);
            }
        }

        isDetailPage() {
            // Check if this is a detail page - single product
            return typeof window.isCampDetailPage !== 'undefined' && window.isCampDetailPage;
        }

        isValidGuid(str) {
            const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            return guidRegex.test(str);
        }

        async loadFromAPI() {
            if (!this.productCollectionId) {
                throw new Error('No product collection configured. Set window.isCampPage = "Running" or "Rowing"');
            }

            // Optimize for detail pages - fetch only single product
            let url;
            if (this.isDetailPage() && this.productIds.length === 1) {
                // Single product endpoint - much faster for detail pages
                const productId = this.productIds[0];
                url = `${CONFIG.API_BASE_URL}/api/v1/client/product-collection/${this.productCollectionId}/product/${productId}`;

                if (CONFIG.DEBUG) {
                    console.log('Fetching single product from optimized API:', url);
                }
            } else {
                // Full collection endpoint - for listing pages
                url = `${CONFIG.API_BASE_URL}/api/v1/client/product-collection/${this.productCollectionId}`;

                if (CONFIG.DEBUG) {
                    console.log('Fetching collection from API:', url);
                }
            }

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (CONFIG.DEBUG) {
                console.log('Loaded data from API:', data);
            }

            // Sort sessions by date
            if (data.products) {
                data.products.forEach(product => {
                    if (product.sessions) {
                        product.sessions.sort((a, b) => {
                            return new Date(a.start_date) - new Date(b.start_date);
                        });
                    }
                });
            }

            // Display all product data
            this.displayProducts(data.products);
        }

        displayProducts(products) {
            if (!products || !Array.isArray(products)) return;

            products.forEach(product => {
                this.displayProduct(product);
            });
        }

        displayProduct(product) {
            const productId = product.product_id || product.productId;
            const productCard = document.querySelector(`.api-camp[id="${productId}"]`);

            if (!productCard) return;

            const productElement = productCard.querySelector('.camps-api-data');
            if (!productElement) return;

            // DEBUG: Log raw product data
            if (product.name && product.name.includes('Winter')) {
                console.log('=== RAW PRODUCT DATA (Winter) ===');
                console.log('Product name:', product.name);
                console.log('Raw prices array:', product.prices);
                console.log('Raw electives array:', product.electives);
            }

            // Clear existing content
            productElement.innerHTML = '';

            this.updateIntroText(productCard, product);

            // Handle purchase button state
            this.updatePurchaseButton(productCard, product);

            // Check if this is a detail page
            if (typeof window.isCampDetailPage !== 'undefined' && window.isCampDetailPage) {
                this.displayDetailPage(productElement, product, productCard);
            } else {
                // Display dates/sessions (listing page)
                this.displaySessions(productElement, product);

                // Display early access message if needed
                this.displayEarlyAccess(productCard, product);

                // Display prices (listing page)
                this.displayPrices(productElement, product);
            }
        }

        displayDetailPage(productElement, product, productCard) {
            const sessions = product.sessions || [];
            const prices = product.prices || [];
            const electives = product.electives || [];

            // Check if we have base prices (excluding deposits)
            const hasBasePrices = prices.some(p =>
                !(p.name || '').toLowerCase().includes('deposit')
            );

            // Only use electives if we have base prices to add them to
            const hasOvernightElectives = electives.some(e =>
                e.elective_type_mapping &&
                e.elective_type_mapping.toLowerCase().includes('overnight')
            );

            // If we have overnight electives but no base prices, warn and skip electives
            if (hasOvernightElectives && !hasBasePrices) {
                console.warn('Product has overnight electives but no base prices - detail page will not display electives:', product.name);
            }

            // Normalize prices - these are base day prices (exclude deposits and waitlist)
            const normalizedPrices = prices
                .filter(p => {
                    const name = (p.name || '').toLowerCase();
                    return !name.includes('deposit') && !name.includes('waitlist');
                })
                .map(p => ({
                    ...p,
                    grouping: p.grouping,
                    sessionStartDate: p.session_start_date || p.sessionStartDate,
                    sessionEndDate: p.session_end_date || p.sessionEndDate,
                    nextTierPrice: p.next_tier_price || p.nextTierPrice,
                    slotsRemaining: p.slots_remaining_in_tier || p.slotsRemainingInTier,
                    totalTierCapacity: p.total_tier_capacity || p.totalTierCapacity
                }));

            // Normalize overnight electives
            const normalizedElectives = electives
                .filter(e => e.elective_type_mapping && e.elective_type_mapping.toLowerCase().includes('overnight'))
                .map(e => ({
                    ...e,
                    electiveTypeMapping: e.elective_type_mapping || e.electiveTypeMapping,
                    sessionStartDate: e.session_start_date || e.sessionStartDate,
                    sessionEndDate: e.session_end_date || e.sessionEndDate,
                    nextTierPrice: e.next_tier_price || e.nextTierPrice,
                    slotsRemaining: e.slots_remaining_in_tier || e.slotsRemainingInTier,
                    totalTierCapacity: e.total_tier_capacity || e.totalTierCapacity
                }));

            // Find the grid and category/ages column (check both class names)
            const grid = productCard.querySelector('.camp-card_grid, .camps-list_card-grid');
            const categoryColumn = grid ? grid.children[1] : null; // 2nd column

            // Determine which layout to use
            const hasMultipleSessions = sessions.length > 1;
            const hasOvernightElectivesToDisplay = normalizedElectives.length > 0 && hasBasePrices;

            let columnCount = 4;
            let columnsHTML = [];

            if (hasMultipleSessions && !hasOvernightElectivesToDisplay) {
                // Design 1: Multiple sessions, no overnight - 4 columns
                columnsHTML = this.displayMultipleSessionsNoGrouping(sessions, normalizedPrices);
                if (columnsHTML.length === 0) {
                    // No valid prices - show early access button and return
                    this.displayEarlyAccess(productCard, product);
                    return;
                }
                columnCount = 4;
            } else if (hasMultipleSessions && hasOvernightElectivesToDisplay) {
                // Design 2/3: Multiple sessions with overnight option
                // Pass both prices and electives separately
                columnsHTML = this.displayMultipleSessionsWithOvernight(sessions, normalizedPrices, normalizedElectives);
                if (columnsHTML.length === 0) {
                    // No valid prices - show early access button and return
                    this.displayEarlyAccess(productCard, product);
                    return;
                }
                columnCount = 4;
            } else if (sessions.length === 1 && hasOvernightElectivesToDisplay) {
                // Design 4: Single session with overnight - 3 columns
                const columnHTML = this.displaySingleSessionWithOvernight(sessions[0], normalizedPrices, normalizedElectives);
                if (columnHTML) {
                    columnsHTML = [columnHTML];
                    columnCount = 3;
                } else {
                    // Fallback to simple display if overnight fails
                    columnsHTML = [this.displaySingleSessionSimple(sessions[0], normalizedPrices)];
                    columnCount = 3;
                }
            } else if (sessions.length >= 1) {
                // Design 5: Single session, no overnight - 3 columns
                const columnHTML = this.displaySingleSessionSimple(sessions[0], normalizedPrices);
                if (columnHTML) {
                    columnsHTML = [columnHTML];
                    columnCount = 3;
                } else {
                    // No valid prices - show early access button and return
                    this.displayEarlyAccess(productCard, product);
                    return;
                }
            } else {
                // No sessions at all - show early access button and return
                this.displayEarlyAccess(productCard, product);
                return;
            }

            // Remove .camps-api-data and insert session columns as grid children
            if (grid && productElement) {
                const parentIndex = Array.from(grid.children).indexOf(productElement.parentElement || productElement);

                // Insert each column HTML as a new grid child
                columnsHTML.forEach((colHTML, index) => {
                    if (!colHTML) return; // Skip empty HTML

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = colHTML;
                    const column = tempDiv.firstElementChild;

                    if (!column) return; // Skip if no element was created

                    if (parentIndex >= 0) {
                        grid.insertBefore(column, grid.children[parentIndex + index + 1]);
                    } else {
                        grid.appendChild(column);
                    }
                });

                // Remove the .camps-api-data placeholder
                productElement.remove();

                // Update grid layout and move category column
                if (columnCount === 3) {
                    grid.classList.add('is-3-cols');
                    if (categoryColumn) {
                        grid.appendChild(categoryColumn);
                    }
                } else {
                    grid.classList.remove('is-3-cols');
                }
            }

            // Show/hide early access button based on whether we have prices and sessions
            this.displayEarlyAccess(productCard, product);
        }

        updateIntroText(productCard, product) {
            const isWaitlist = product.purchase_button_state === 'JoinWaitlist';

            if (!isWaitlist) return;

            const elements = productCard.querySelectorAll('p.camp-intro-text');

            const WAITLIST_TEST = "This program is currently full. Join the waitlist to be notified if a spot becomes available.";

            elements.forEach(text => {
                text.textContent = WAITLIST_TEST;
            });
        }

        updatePurchaseButton(productCard, product) {
            const buttonState =
                product.purchase_button_state || product.purchaseButtonState;

            const alumniAccess =
                product.alumni_access || product.alumniAccess;

            console.log("alumniAccess: "+alumniAccess);

            const isAlumniAccessActive =
                alumniAccess && alumniAccess.active === true;

            const applyButtons =
                productCard.querySelectorAll('a.btn-apply-now');

            if (applyButtons.length === 0) return;

            applyButtons.forEach(applyButton => {
                const wrapper = applyButton.parentElement;

                if (!buttonState || buttonState === 'None') {
                    if (
                        wrapper &&
                        wrapper.classList.contains('btn-apply-now')
                    ) {
                        wrapper.style.display = 'none';
                    } else {
                        applyButton.style.display = 'none';
                    }
                } else {
                    if (
                        wrapper &&
                        wrapper.classList.contains('btn-apply-now')
                    ) {
                        wrapper.style.display = '';
                    } else {
                        applyButton.style.display = '';
                    }

                    const buttonTextMap = {
                        Register: 'Register Now!',
                        Apply: 'Apply Now!',
                        JoinWaitlist: 'Join Waitlist',
                        ReserveSlot: 'Reserve Slot'
                    };

                    const newText = isAlumniAccessActive
                        ? 'Alumni Registration Open'
                        : buttonTextMap[buttonState] || buttonState;
                      applyButton.textContent = newText;
                }

                const buttonContainer =
                    wrapper &&
                    wrapper.classList.contains('btn-apply-now')
                        ? wrapper
                        : applyButton;

                let alumniMessage = buttonContainer.nextElementSibling;

                if (
                    !alumniMessage ||
                    !alumniMessage.classList.contains(
                        'alumni-access-message'
                    )
                ) {
                    alumniMessage = null;
                }

                const generalOpensAtValue =
                    alumniAccess &&
                    (
                        alumniAccess.general_opens_at ||
                        alumniAccess.generalOpensAt
                    );

                if (
                    buttonState &&
                    buttonState !== 'None' &&
                    isAlumniAccessActive &&
                    generalOpensAtValue
                ) {
                    if (!alumniMessage) {
                        alumniMessage =
                            document.createElement('div');

                        alumniMessage.className =
                            'alumni-access-message';

                        alumniMessage.style.cssText =
                            'margin-top:0.5rem;' +
                            'font-size:0.875rem;' +
                            'line-height:1.4;';

                        buttonContainer.insertAdjacentElement(
                            'afterend',
                            alumniMessage
                        );
                    }

                    const generalOpensAt =
                        this.formatDateTimeAsProvided(
                            generalOpensAtValue
                        );

                    alumniMessage.textContent =
                        `General registration opens ${generalOpensAt}.`;

                    alumniMessage.style.display = '';
                } else if (alumniMessage) {
                    // Remove the message when alumni access ends.
                    alumniMessage.remove();
                }
            });
        }

        displaySessions(productElement, product) {
            const sessions = product.sessions || [];
            const prices = product.prices || [];

            // Add DATES label
            const datesLabel = document.createElement('div');
            datesLabel.className = 'camps-listing-label';
            datesLabel.textContent = 'DATES';
            productElement.appendChild(datesLabel);

            if (sessions.length === 0) {
                // Show early access message
                const nextYear = new Date().getFullYear() + 1;
                const earlyAccessDiv = document.createElement('div');
                earlyAccessDiv.className = 'dates-and-cost';
                earlyAccessDiv.style.cssText = 'font-size:1.25rem;color:#001b41;font-weight:600';
                earlyAccessDiv.textContent = `Sign-Up for ${nextYear} Early Access!`;
                productElement.appendChild(earlyAccessDiv);
            } else {
                // Display each session
                sessions.forEach(session => {
                    const startDate = this.formatDate(session.start_date || session.startDate, 'MMM-DD');
                    const endDate = this.formatDate(session.end_date || session.endDate, 'MMM-DD, YYYY');
                    const inventoryState = prices.length ?
                        (session.inventory_state || session.inventoryState || '').toLowerCase() : '';

                    const datesDiv = document.createElement('div');
                    datesDiv.className = 'dates-and-cost';
                    datesDiv.innerHTML = `
                        <div class="camp-dates-card flex">
                            <div class="event-start-date">${startDate}</div>
                            <div class="camps-date">&nbsp;-&nbsp;</div>
                            <div class="event-end-date">${endDate}</div>
                            ${inventoryState ? `<div class="inventory_state-${inventoryState}"></div>` : ''}
                        </div>
                    `;
                    productElement.appendChild(datesDiv);
                });
            }
        }

        displayEarlyAccess(productCard, product) {
            const sessions = product.sessions || [];
            const prices = product.prices || [];
            const earlyAccessButtons = productCard.querySelectorAll('.get-early-access');

            if (earlyAccessButtons.length > 0) {
                const shouldShow = prices.length === 0 || sessions.length === 0;

                earlyAccessButtons.forEach(earlyAccessDiv => {
                    if (shouldShow) {
                        earlyAccessDiv.style.display = 'inline-block';
                    } else {
                        earlyAccessDiv.style.display = 'none';
                    }
                });
            }
        }

        displayPrices(productElement, product) {
            // Check if we should use electives (for overnight/day distinction)
            const electives = product.electives || [];
            const hasOvernightElective = electives.some(e =>
                e.elective_type_mapping &&
                e.elective_type_mapping.toLowerCase().includes('overnight')
            );

            if (hasOvernightElective) {
                // All camps are day camps, but this one has overnight option
                // displayElectivePrices will add COST label if it has prices to display
                this.displayElectivePrices(productElement, product);
            } else {
                // Regular day camp only - just show price range
                let pricesToDisplay = product.prices || [];

                // Normalize field names for consistency
                pricesToDisplay = pricesToDisplay.map(price => ({
                    ...price,
                    currencyCode: price.currency_code || price.currencyCode,
                    discountPrice: price.discount_price || price.discountPrice,
                    priceId: price.product_price_id || price.priceId
                }));

                // Filter by current currency and exclude deposits and waitlist prices
                pricesToDisplay = pricesToDisplay.filter(price => {
                    const name = (price.name || '').toLowerCase();
                    return price.currencyCode === this.currentCurrency &&
                           !name.includes('deposit') &&
                           !name.includes('waitlist');
                });

                // Only show COST label if we have prices to display
                if (pricesToDisplay.length === 0) return;

                // Add COST label
                const costLabel = document.createElement('div');
                costLabel.className = 'camps-listing-label';
                costLabel.textContent = 'COST';
                productElement.appendChild(costLabel);

                // Group prices by name to show ranges
                const priceGroups = this.groupPricesByName(pricesToDisplay);

                // Display each price group
                priceGroups.forEach(group => {
                    this.displayPriceRange(productElement, group, product.product_id);
                });
            }
        }

        displayElectivePrices(productElement, product) {
            const electives = product.electives || [];
            const prices = product.prices || [];
            const currencySymbol = this.getCurrencySymbol();

            // Get base day prices (excluding deposits and waitlist)
            const dayPrices = prices
                .filter(p => {
                    const name = (p.name || '').toLowerCase();
                    return (p.currency_code || p.currencyCode) === this.currentCurrency &&
                           !name.includes('deposit') &&
                           !name.includes('waitlist');
                })
                .map(p => p.price);

            // If no day prices found, don't display elective pricing or COST label
            if (dayPrices.length === 0) {
                console.warn('Product has overnight electives but no day prices - skipping elective display:', product.name);
                return;
            }

            // Add COST label since we have prices to display
            const costLabel = document.createElement('div');
            costLabel.className = 'camps-listing-label';
            costLabel.textContent = 'COST';
            productElement.appendChild(costLabel);

            const minDayPrice = Math.min(...dayPrices);
            const maxDayPrice = Math.max(...dayPrices);

            // Display day camper prices
            const dayPriceContainer = document.createElement('div');
            dayPriceContainer.className = 'camp-prices';
            dayPriceContainer.setAttribute('data-product-id', product.product_id);

            if (minDayPrice === maxDayPrice) {
                dayPriceContainer.innerHTML = `
                    <div class="camps-actual-cost">${currencySymbol}${this.formatPrice(minDayPrice)}</div>
                `;
            } else {
                dayPriceContainer.innerHTML = `
                    <div class="camps-actual-cost">${currencySymbol}${this.formatPrice(minDayPrice)} - ${currencySymbol}${this.formatPrice(maxDayPrice)}</div>
                `;
            }

            productElement.appendChild(dayPriceContainer);

            const dayLabel = document.createElement('div');
            dayLabel.className = 'camps-listing-label';
            dayLabel.textContent = 'Day Campers';
            productElement.appendChild(dayLabel);

            // Get overnight elective prices
            const overnightElectives = electives.filter(e =>
                e.elective_type_mapping &&
                e.elective_type_mapping.toLowerCase().includes('overnight') &&
                (e.currency_code || e.currencyCode) === this.currentCurrency
            );

            // Display overnight prices (day price + overnight elective)
            if (overnightElectives.length > 0) {
                const overnightElectivePrices = overnightElectives.map(e => e.price);
                const minOvernightElective = Math.min(...overnightElectivePrices);
                const maxOvernightElective = Math.max(...overnightElectivePrices);

                // Calculate total overnight prices (day + overnight elective)
                const minOvernightTotal = minDayPrice + minOvernightElective;
                const maxOvernightTotal = maxDayPrice + maxOvernightElective;

                const overnightPriceContainer = document.createElement('div');
                overnightPriceContainer.className = 'camp-prices';
                overnightPriceContainer.setAttribute('data-product-id', product.product_id);

                if (minOvernightTotal === maxOvernightTotal) {
                    overnightPriceContainer.innerHTML = `
                        <div class="camps-actual-cost">${currencySymbol}${this.formatPrice(minOvernightTotal)}</div>
                    `;
                } else {
                    overnightPriceContainer.innerHTML = `
                        <div class="camps-actual-cost">${currencySymbol}${this.formatPrice(minOvernightTotal)} - ${currencySymbol}${this.formatPrice(maxOvernightTotal)}</div>
                    `;
                }

                productElement.appendChild(overnightPriceContainer);

                const overnightLabel = document.createElement('div');
                overnightLabel.className = 'camps-listing-label';
                overnightLabel.textContent = 'Overnight Campers';
                productElement.appendChild(overnightLabel);
            }
        }

        groupPricesByName(prices) {
            const groups = {
                deposit: {
                    name: '',
                    prices: [],
                    priceIds: []
                },
                regular: {
                    name: '',
                    prices: [],
                    priceIds: []
                }
            };

            prices.forEach(price => {
                const name = price.name || 'Price';
                const isDeposit = name.toLowerCase().includes('deposit');

                if (isDeposit) {
                    groups.deposit.name = name;
                    groups.deposit.prices.push(price.price);
                    groups.deposit.priceIds.push(price.priceId);
                } else {
                    // Use a generic name or the first non-session-specific part
                    if (!groups.regular.name) {
                        // Extract year (e.g., "2026" from "2026 - Session 1")
                        const yearMatch = name.match(/\d{4}/);
                        groups.regular.name = yearMatch ? yearMatch[0] : name;
                    }
                    groups.regular.prices.push(price.price);
                    groups.regular.priceIds.push(price.priceId);
                }
            });

            // Convert to array, filter empty groups, and calculate min/max
            const result = [];

            // Only include regular prices (not deposits) on listing page
            if (groups.regular.prices.length > 0) {
                result.push({
                    name: groups.regular.name,
                    minPrice: Math.min(...groups.regular.prices),
                    maxPrice: Math.max(...groups.regular.prices),
                    priceIds: groups.regular.priceIds
                });
            }

            // Deposits are excluded from listing page display

            return result;
        }

        displayPriceRange(productElement, priceGroup, productId) {
            const currencySymbol = this.getCurrencySymbol();
            const minFormatted = `${currencySymbol}${this.formatPrice(priceGroup.minPrice)}`;
            const maxFormatted = `${currencySymbol}${this.formatPrice(priceGroup.maxPrice)}`;

            // Create price container
            const priceContainer = document.createElement('div');
            priceContainer.className = 'camp-prices';

            // Add tracking attributes for SignalR updates
            priceContainer.setAttribute('data-product-id', productId);
            priceContainer.setAttribute('data-currency-code', this.currentCurrency);

            // Store price IDs for potential SignalR updates
            if (priceGroup.priceIds.length > 0) {
                priceContainer.setAttribute('data-price-ids', priceGroup.priceIds.join(','));
            }

            // Display as range if min !== max, otherwise single price
            if (priceGroup.minPrice === priceGroup.maxPrice) {
                priceContainer.innerHTML = `
                    <div class="camps-actual-cost">${minFormatted}</div>
                `;
            } else {
                priceContainer.innerHTML = `
                    <div class="camps-actual-cost">${minFormatted} - ${maxFormatted}</div>
                `;
            }

            productElement.appendChild(priceContainer);

            // Track this element for real-time SignalR price updates
            priceGroup.priceIds.forEach(priceId => {
                if (!this.priceElements.has(priceId)) {
                    this.priceElements.set(priceId, []);
                }
                this.priceElements.get(priceId).push(priceContainer);
            });
        }

        displayPrice(productElement, price, productId) {
            const currencySymbol = this.getCurrencySymbol();
            const formattedPrice = `${currencySymbol}${this.formatPrice(price.price)}`;

            // Create price container
            const priceContainer = document.createElement('div');
            priceContainer.className = 'camp-prices';

            // Add tracking attributes for SignalR updates
            priceContainer.setAttribute('data-product-id', productId);
            if (price.priceId) {
                priceContainer.setAttribute('data-product-price-id', price.priceId);
            }
            priceContainer.setAttribute('data-currency-code', price.currencyCode);

            // Create price HTML
            const discountPrice = price.discountPrice;
            if (discountPrice && discountPrice < price.price) {
                const formattedDiscountPrice = `${currencySymbol}${this.formatPrice(discountPrice)}`;
                priceContainer.innerHTML = `
                    <div class="camps-actual-cost" style="text-decoration: line-through;color:#666565">${formattedPrice}</div>
                    <div class="camps-date">&nbsp;</div>
                    <div class="camps-discounted-cost">${formattedDiscountPrice}</div>
                `;
            } else {
                priceContainer.innerHTML = `
                    <div class="camps-actual-cost">${formattedPrice}</div>
                `;
            }

            productElement.appendChild(priceContainer);

            // Add price label
            const priceLabel = document.createElement('div');
            priceLabel.className = 'camps-listing-label';
            priceLabel.textContent = price.name;
            productElement.appendChild(priceLabel);

            // Track this element for real-time SignalR price updates
            if (price.priceId) {
                const key = price.priceId;
                if (!this.priceElements.has(key)) {
                    this.priceElements.set(key, []);
                }
                this.priceElements.get(key).push(priceContainer);
            }
        }

        formatDate(dateString, format) {
            if (!dateString) return '';

            // Extract date part (YYYY-MM-DD) from ISO date string
            const [datePart] = dateString.split('T');
            const [year, month, day] = datePart.split('-').map(Number);

            const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const daySuffix = this.getDaySuffix(day);

            switch (format) {
                case 'MMM-DD':
                    return `${monthNamesShort[month - 1]} ${day}${daySuffix}`;
                case 'MMM-DD, YYYY':
                    return `${monthNamesShort[month - 1]} ${day}${daySuffix}, ${year}`;
                default:
                    return dateString;
            }
        }

        getDaySuffix(day) {
            if (day >= 11 && day <= 13) return 'th';
            switch (day % 10) {
                case 1: return 'st';
                case 2: return 'nd';
                case 3: return 'rd';
                default: return 'th';
            }
        }

        updateCurrency() {
            const storedCountry = localStorage.getItem('selectedCountry');
            this.currentCurrency = (storedCountry === 'UK') ? 'GBP' : 'USD';
        }

        watchCurrencyChanges() {
            // Watch for changes to the country selector
            const countrySelect = document.getElementById('country-select');
            if (countrySelect) {
                countrySelect.addEventListener('change', async () => {
                    this.updateCurrency();

                    // Show loading
                    this.showLoading(true);

                    // Reload all data for new currency
                    await this.loadFromAPI();

                    // Hide loading
                    this.showLoading(false);
                });
            }
        }

        getCurrencySymbol() {
            return this.currentCurrency === 'GBP' ? '£' : '$';
        }

        formatPrice(price) {
            return parseFloat(price).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }

        async loadSignalR() {
            if (typeof signalR !== 'undefined') return;

            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@microsoft/signalr@latest/dist/browser/signalr.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        async connect() {
            try {
                // Create SignalR connection for real-time price updates only
                this.connection = new signalR.HubConnectionBuilder()
                    .withUrl(CONFIG.HUB_URL)
                    .withAutomaticReconnect()
                    .configureLogging(CONFIG.DEBUG ? signalR.LogLevel.Debug : signalR.LogLevel.Error)
                    .build();

                // Handle real-time price updates from server
                this.connection.on('PriceUpdated', (data) => {
                    this.updatePrice(data);
                });

                // Handle tier changes (affects pricing)
                this.connection.on('TierChanged', (data) => {
                    if (CONFIG.DEBUG) {
                        console.log('Tier changed:', data);
                    }
                });

                // Handle reconnection
                this.connection.onreconnected(() => {
                    if (CONFIG.DEBUG) {
                        console.log('Reconnected to price hub');
                    }
                    this.connection.invoke('JoinPriceGroup');
                });

                // Start connection
                await this.connection.start();

                // Join price updates group
                await this.connection.invoke('JoinPriceGroup');

                if (CONFIG.DEBUG) {
                    console.log('Connected to SignalR for real-time price updates');
                }
            } catch (error) {
                console.error('SignalR connection failed:', error);
                // Continue without real-time updates (prices from JSON still work)
            }
        }

        updatePrice(data) {
            const {
                ProductVariantId,
                ProductPriceId,
                CurrentPrice,
                DiscountPrice,
                CurrencyCode,
                TierName,
                InventoryRemaining,
                PercentageFilled,
                SlotsRemainingInTier,
                TotalTierCapacity
            } = data;

            // Only update if currency matches current selection
            if (CurrencyCode && CurrencyCode !== this.currentCurrency) {
                return;
            }

            // Find elements for this price ID
            const key = ProductPriceId;
            const elements = this.priceElements.get(key);
            if (!elements || elements.length === 0) {
                if (CONFIG.DEBUG) {
                    console.log('No elements found for price update:', ProductPriceId);
                }
                return;
            }

            // Update all matching price elements
            elements.forEach(element => {
                this.setPriceDisplay(element, CurrentPrice, DiscountPrice);

                // Update data attributes
                if (TierName) {
                    element.setAttribute('data-current-tier', TierName);
                }
                if (InventoryRemaining !== undefined) {
                    element.setAttribute('data-inventory', InventoryRemaining);
                }
                if (PercentageFilled !== undefined) {
                    element.setAttribute('data-percent-filled', PercentageFilled);
                }

                // Update progress bar and slot count on detail pages
                if (SlotsRemainingInTier !== undefined && TotalTierCapacity !== undefined) {
                    this.updateDetailPageSlots(element, SlotsRemainingInTier, TotalTierCapacity);
                }
            });

            if (CONFIG.DEBUG) {
                console.log('Price updated via SignalR:', data);
            }
        }

        updateDetailPageSlots(priceElement, slotsRemaining, totalCapacity) {
            // Find the parent column that contains this price element
            // The structure is: column > price card > progress bar & slot text
            let column = priceElement.closest('.card-right-border') || priceElement.closest('[class*="card"]');

            if (!column) return;

            // Update progress bar
            const progressBar = column.querySelector('.slots-availability');
            if (progressBar) {
                const percentageWidth = this.calculateInventoryWidth(slotsRemaining, totalCapacity);
                progressBar.style.width = `${percentageWidth}%`;

                // Add animation class
                progressBar.classList.add('price-updated');
                setTimeout(() => {
                    progressBar.classList.remove('price-updated');
                }, 300);
            }

            // Update slot count text
            const slotText = column.querySelector('.camps-card_small-text');
            if (slotText) {
                slotText.textContent = this.getSlotsText(slotsRemaining);

                // Update warning class based on slots remaining
                slotText.className = 'camps-card_small-text';
                if (slotsRemaining <= 5) {
                    slotText.classList.add('is-color-red');
                }

                // Add animation class
                slotText.classList.add('price-updated');
                setTimeout(() => {
                    slotText.classList.remove('price-updated');
                }, 300);
            }

            if (CONFIG.DEBUG) {
                console.log('Updated detail page slots:', {
                    slotsRemaining,
                    totalCapacity,
                    progressBar: !!progressBar,
                    slotText: !!slotText
                });
            }
        }

        setPriceDisplay(element, price, discountPrice) {
            const currencySymbol = this.getCurrencySymbol();
            const formattedPrice = `${currencySymbol}${this.formatPrice(price)}`;

            // Find the actual price display elements
            const actualCostElement = element.querySelector('.camps-actual-cost');
            const discountedCostElement = element.querySelector('.camps-discounted-cost');

            if (discountPrice && discountPrice < price) {
                // Show discount price
                const formattedDiscountPrice = `${currencySymbol}${this.formatPrice(discountPrice)}`;

                if (actualCostElement) {
                    actualCostElement.textContent = formattedPrice;
                    actualCostElement.style.textDecoration = 'line-through';
                    actualCostElement.style.color = '#666565';
                }

                if (discountedCostElement) {
                    discountedCostElement.textContent = formattedDiscountPrice;
                    discountedCostElement.style.display = '';
                } else if (actualCostElement) {
                    // Create discount element if it doesn't exist
                    const parent = actualCostElement.parentElement;

                    // Add spacer if needed
                    if (!parent.querySelector('.camps-date')) {
                        const spacer = document.createElement('div');
                        spacer.className = 'camps-date';
                        spacer.innerHTML = '&nbsp;';
                        parent.appendChild(spacer);
                    }

                    const newDiscountElement = document.createElement('div');
                    newDiscountElement.className = 'camps-discounted-cost';
                    newDiscountElement.textContent = formattedDiscountPrice;
                    parent.appendChild(newDiscountElement);
                }
            } else {
                // No discount, show regular price
                if (actualCostElement) {
                    actualCostElement.textContent = formattedPrice;
                    actualCostElement.style.textDecoration = '';
                    actualCostElement.style.color = '';
                }

                // Hide or remove discount price element
                if (discountedCostElement) {
                    discountedCostElement.style.display = 'none';
                }
            }

            // Add a subtle animation class (optional - requires CSS)
            element.classList.add('price-updated');
            setTimeout(() => {
                element.classList.remove('price-updated');
            }, 300);
        }

        // Design 5: Single session, no grouping - simplest design
        displaySingleSessionSimple(session, prices) {
            if (!session) return '';

            const price = prices.find(p => {
                const name = (p.name || '').toLowerCase();
                return !name.includes('deposit') && !name.includes('waitlist');
            });
            if (!price) return '';

            const currencySymbol = this.getCurrencySymbol();
            const formattedPrice = `${currencySymbol}${this.formatPrice(price.price)}`;
            
            const isWaitlist = session.inventory_state === "Waitlist";
            const nextPrice = (price.nextTierPrice && !isWaitlist) ? `${currencySymbol}${this.formatPrice(price.nextTierPrice)}` : null;

            return `
                <div class="card-right-border">
                    <div class="camps-list_card-label">DATES</div>
                    <div class="camp-card_value">${this.formatDate(session.start_date, 'MMM-DD')} - ${this.formatDate(session.end_date, 'MMM-DD, YYYY')}</div>
                    <div class="spacer-small"></div>
                    <div class="camps-list_card-label">PRICE</div>
                    <div class="camp-card_price-card">
                        <div class="price-card_set">
                            <div class="camp-card_price">${formattedPrice}</div>
                        </div>
                        ${nextPrice ? `<div class="camps-list_card-label">NEXT PRICE: ${nextPrice}</div>` : ''}
                    </div>
                    ${isWaitlist ? `` : `
                    <div class="slots-availability-base">
                        <div class="slots-availability" style="width: ${this.calculateInventoryWidth(price.slotsRemaining || session.inventory_remaining, price.totalTierCapacity || price.total_tier_capacity)}%"></div>
                    </div>
                    <div class="camps-card_small-text ${this.getSlotsWarningClass(price.slotsRemaining)}">${this.getSlotsText(price.slotsRemaining || session.inventory_remaining)}</div>
                    `}
                </div>
            `;
        }

        // Design 4: Single session with overnight option
        displaySingleSessionWithOvernight(session, prices, electives) {
            if (!session || !prices || prices.length === 0) return '';

            const currencySymbol = this.getCurrencySymbol();

            // Get base day price for this session
            const dayPrice = prices.find(p =>
                p.sessionStartDate && new Date(p.sessionStartDate).getTime() === new Date(session.start_date).getTime()
            ) || prices[0];

            if (!dayPrice) return '';

            // Get overnight elective for this session
            const overnightElective = electives && electives.length > 0 ? (
                electives.find(e =>
                    e.sessionStartDate && new Date(e.sessionStartDate).getTime() === new Date(session.start_date).getTime()
                ) || electives[0]
            ) : null;

            if (!overnightElective) return '';

            // Calculate overnight total = day price + overnight elective
            const overnightTotal = dayPrice.price + overnightElective.price;

            const tierCapacity = dayPrice.totalTierCapacity || dayPrice.total_tier_capacity;
            const slotsRemaining = dayPrice.slotsRemaining || session.inventory_remaining;

            const isWaitlist = session.inventory_state === "Waitlist";

            return `
                <div class="card-right-border">
                    <div class="camps-list_card-label">DATES</div>
                    <div class="camp-card_value">${this.formatDate(session.start_date, 'MMM-DD')} - ${this.formatDate(session.end_date, 'MMM-DD, YYYY')}</div>
                    ${isWaitlist ? `` : `
                    <div class="slots-availability-base">
                        <div class="slots-availability" style="width: ${this.calculateInventoryWidth(slotsRemaining, tierCapacity)}%"></div>
                    </div>
                    <div class="camps-card_small-text">${this.getSlotsText(slotsRemaining)}</div>
                    `}
                    <div class="spacer-small"></div>
                    <div class="camps-list_card-label">PRICE</div>
                    <div class="camp-card_price-card">
                        <div class="price-card_set">
                            <div class="camp-card_price">${currencySymbol}${this.formatPrice(overnightTotal)}</div>
                        </div>
                    </div>
                    <div class="text-size-small">for Overnight Campers</div>
                    <div class="spacer-tiny"></div>
                    <div class="camp-card_price-card">
                        <div class="price-card_set">
                            <div class="camp-card_price">${currencySymbol}${this.formatPrice(dayPrice.price)}</div>
                        </div>
                    </div>
                    <div class="text-size-small">for Day Campers</div>
                </div>
            `;
        }

        // Design 1: Multiple sessions, no grouping
        displayMultipleSessionsNoGrouping(sessions, prices) {
            const currencySymbol = this.getCurrencySymbol();
            const columns = [];

            sessions.forEach((session, index) => {
                const sessionNum = index + 1;

                // Try to match by date first
                const sessionPrices = prices.filter(p =>
                    p.sessionStartDate && new Date(p.sessionStartDate).getTime() === new Date(session.start_date).getTime()
                );
                let price = sessionPrices.find(p => {
                    const name = (p.name || '').toLowerCase();
                    return !name.includes('deposit') && !name.includes('waitlist');
                });

                // Fallback: if no date match, use prices in order
                if (!price && prices[index]) {
                    price = prices[index];
                }

                const isWaitlist = session.inventory_state === "Waitlist";
                const nextPrice = (price.nextTierPrice && !isWaitlist) ? `${currencySymbol}${this.formatPrice(price.nextTierPrice)}` : null;

                if (price) {
                    columns.push(`
                        <div class="${index < sessions.length - 1 ? 'card-right-border' : ''}">
                            <div class="camps-list_card-label">SESSION ${sessionNum} DATES</div>
                            <div class="camp-card_value">${this.formatDate(session.start_date, 'MMM-DD')} - ${this.formatDate(session.end_date, 'MMM-DD, YYYY')}</div>
                            <div class="spacer-small"></div>
                            <div class="camps-list_card-label">SESSION ${sessionNum} PRICE</div>
                            <div class="camp-card_price-card">
                                <div class="price-card_set">
                                    <div class="camp-card_price">${currencySymbol}${this.formatPrice(price.price)}</div>
                                </div>
                                ${nextPrice ? `<div class="camps-list_card-label">NEXT PRICE: ${nextPrice}</div>` : ''}
                            </div>
                            ${isWaitlist ? `` : `
                            <div class="slots-availability-base">
                                <div class="slots-availability" style="width: ${this.calculateInventoryWidth(price.slotsRemaining || session.inventory_remaining, price.totalTierCapacity || price.total_tier_capacity)}%"></div>
                            </div>
                            <div class="camps-card_small-text ${this.getSlotsWarningClass(price.slotsRemaining)}">${this.getSlotsText(price.slotsRemaining || session.inventory_remaining)}</div>
                            `}
                        </div>
                    `);
                }
            });

            return columns;
        }

        // Design 2/3: Multiple sessions with overnight option
        displayMultipleSessionsWithOvernight(sessions, prices, electives) {
            if (!prices || prices.length === 0) return [];

            const currencySymbol = this.getCurrencySymbol();
            const columns = [];

            sessions.forEach((session, index) => {
                const sessionNum = index + 1;

                // Get base day price for this session
                // First try to match by date, then fall back to index
                let dayPrice = prices.find(p =>
                    p.sessionStartDate && new Date(p.sessionStartDate).getTime() === new Date(session.start_date).getTime()
                );

                // Fallback: if no date match, use prices in order
                if (!dayPrice && prices[index]) {
                    dayPrice = prices[index];
                }

                if (!dayPrice) return;

                // Get overnight elective for this session (if electives exist)
                // First try to find session-specific elective, then fall back to first available
                const overnightElective = electives && electives.length > 0 ? (
                    electives.find(e =>
                        e.sessionStartDate && new Date(e.sessionStartDate).getTime() === new Date(session.start_date).getTime()
                    ) || electives[0]
                ) : null;

                // Calculate overnight total = day price + overnight elective
                const overnightTotal = overnightElective ? dayPrice.price + overnightElective.price : null;

                const tierCapacity = dayPrice.totalTierCapacity || dayPrice.total_tier_capacity;
                const slotsRemaining = dayPrice.slotsRemaining || session.inventory_remaining;

                const isWaitlist = session.inventory_state === "Waitlist";

                columns.push(`
                    <div class="${index < sessions.length - 1 ? 'card-right-border' : ''}">
                        <div class="camps-list_card-label">SESSION ${sessionNum} DATES</div>
                        <div class="camp-card_value">${this.formatDate(session.start_date, 'MMM-DD')} - ${this.formatDate(session.end_date, 'MMM-DD, YYYY')}</div>
                        ${isWaitlist ? `` : `
                        <div class="slots-availability-base">
                            <div class="slots-availability" style="width: ${this.calculateInventoryWidth(slotsRemaining, tierCapacity)}%"></div>
                        </div>
                        <div class="camps-card_small-text">${this.getSlotsText(slotsRemaining)}</div>
                        `}
                        <div class="spacer-small"></div>
                        <div class="camps-list_card-label">SESSION ${sessionNum} PRICE</div>
                        ${overnightTotal ? `
                            <div class="camp-card_price-card">
                                <div class="price-card_set">
                                    <div class="camp-card_price">${currencySymbol}${this.formatPrice(overnightTotal)}</div>
                                </div>
                            </div>
                            <div class="text-size-small">for Overnight Campers</div>
                            <div class="spacer-tiny"></div>
                        ` : ''}
                        <div class="camp-card_price-card">
                            <div class="price-card_set">
                                <div class="camp-card_price">${currencySymbol}${this.formatPrice(dayPrice.price)}</div>
                            </div>
                        </div>
                        <div class="text-size-small">for Day Campers</div>
                    </div>
                `);
            });

            return columns;
        }

        // Helper methods for detail pages
        calculateInventoryWidth(remaining, tierCapacity = null) {
            if (tierCapacity && tierCapacity > 0) {
                // Calculate percentage filled in current tier
                const filled = tierCapacity - remaining;
                return Math.min(100, Math.max(0, (filled / tierCapacity) * 100));
            }
            // Fallback: Assuming 100% = 50 slots, adjust as needed
            return Math.min(100, (remaining / 50) * 100);
        }

        getSlotsWarningClass(slots) {
            if (!slots) return '';
            return slots <= 5 ? 'is-color-red' : '';
        }

        getSlotsText(slots) {
            if (slots > 5) {
                return `*5+ slot(s) remaining at this price`;
            }
            return `*${slots} slot(s) remaining at this price`;
        }

        formatDateTimeAsProvided(dateString) {
            if (!dateString) return '';
        
            // Read the ISO components directly. This prevents the
            // browser from converting the value to another timezone.
            const match = dateString.match(
                /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
            );
        
            if (!match) return dateString;
        
            const [
                ,
                year,
                month,
                day,
                hour,
                minute
            ] = match;
        
            const monthNamesShort = [
                'Jan',
                'Feb',
                'Mar',
                'Apr',
                'May',
                'Jun',
                'Jul',
                'Aug',
                'Sep',
                'Oct',
                'Nov',
                'Dec'
            ];
        
            const hourNumber = Number(hour);
            const hour12 = hourNumber % 12 || 12;
            const period = hourNumber >= 12 ? 'PM' : 'AM';
            const dayNumber = Number(day);
        
            return (
                `${monthNamesShort[Number(month) - 1]} ` +
                `${dayNumber}${this.getDaySuffix(dayNumber)}, ` +
                `${year} at ${hour12}:${minute} ${period}`
            );
        }
    }

    // Initialize
    window.priceUpdater = new PriceUpdater();

})();
