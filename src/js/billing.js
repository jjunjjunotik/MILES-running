/* ==========================================================================
   MILES · billing
   Buying Supporter or Pro in the phone app: the App Store on iPhone, Google
   Play on Android, both through RevenueCat's SDK
   (@revenuecat/purchases-capacitor).

   The store takes the money; the server decides what it bought. After a
   purchase the app asks the server to check with RevenueCat at once
   (/v1/billing/sync), so Pro is on before the webhook arrives. Prices shown
   are the store's own, in the runner's currency — never the dollar figures
   in pro.js, which are only the demo's.

   Needs a signed-in account, the phone app, and the store's public key for
   the platform (meta tags miles-rc-ios and miles-rc-android, written by
   scripts/build-www.js). Without them nothing can be bought, and the app
   says so rather than pretending.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Api, State, Bus, esc } = M;
  const CANCELLED = '1';            // PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR

  const toast = (html) => { if (M.UI) M.UI.toast(html); };
  const meta = (name) => {
    const tag = document.querySelector(`meta[name="${name}"]`);
    return tag && tag.content.trim() ? tag.content.trim() : null;
  };
  /** "pro_yearly:base-plan" (Google) and "pro_yearly" (Apple) are the same plan. */
  const planOf = (identifier) => String(identifier || '').split(':')[0];

  const Billing = {
    products: {},
    configured: false,
    userId: null,
    managementURL: null,

    platform() {
      const C = window.Capacitor;
      return C && C.isNativePlatform && C.isNativePlatform() ? C.getPlatform() : null;
    },

    plugin() {
      const C = window.Capacitor;
      if (!this.platform() || !C.registerPlugin) return null;
      if (!this._plugin) this._plugin = C.registerPlugin('Purchases');
      return this._plugin;
    },

    key() {
      const platform = this.platform();
      return platform === 'ios' ? meta('miles-rc-ios') : platform === 'android' ? meta('miles-rc-android') : null;
    },

    /** Whether this build can take a payment at all. */
    available() {
      return !!(Api.enabled && this.key() && this.plugin());
    },

    /** Signing in: the store learns who is buying, so a purchase lands on this account. */
    async start(user) {
      if (!this.available() || !user) return;
      const store = this.plugin();
      try {
        if (!this.configured) {
          await store.configure({ apiKey: this.key(), appUserID: user.id });
          this.configured = true;
        } else if (this.userId !== user.id) {
          await store.logIn({ appUserID: user.id });
        }
        this.userId = user.id;
        await this.loadPrices();
        await this.current();          // and the store's own page for managing it
      } catch (err) {
        console.warn('[miles] store:', err && err.message);
      }
    },

    async stop() {
      if (!this.configured || !this.userId) return;
      this.userId = null;
      this.managementURL = null;
      try { await this.plugin().logOut(); } catch (err) { /* already anonymous */ }
    },

    async loadPrices() {
      const ids = Object.keys(M.Pro.PLANS);
      const { products } = await this.plugin().getProducts({ productIdentifiers: ids, type: 'SUBSCRIPTION' });
      this.products = {};
      (products || []).forEach((p) => { this.products[planOf(p.identifier)] = p; });
      Bus.emit('billing:prices');
    },

    /** The store's price for a plan, as the store writes it ("₩6,500"), or null. */
    price(planId) {
      const product = this.products[planId];
      return product ? product.priceString : null;
    },

    /** "₩6,500 / mo": the store's price with the plan's period, or null. */
    label(planId) {
      const price = this.price(planId);
      return price ? `${price} / ${M.Pro.PLANS[planId].period === 'year' ? 'yr' : 'mo'}` : null;
    },

    /** What this store account is subscribed to right now, as plan ids. */
    async current() {
      try {
        const { customerInfo } = await this.plugin().getCustomerInfo();
        this.managementURL = (customerInfo && customerInfo.managementURL) || null;
        return ((customerInfo && customerInfo.activeSubscriptions) || []).map(planOf).filter((id) => M.Pro.PLANS[id]);
      } catch (err) {
        return [];
      }
    },

    async purchase(planId) {
      if (!this.available()) {
        toast('Subscriptions are bought in the MILES app from the App Store or Google Play.');
        return false;
      }
      const product = this.products[planId];
      if (!product) {
        toast('That plan is not available from the store right now. Try again in a moment.');
        this.loadPrices().catch(() => {});
        return false;
      }
      const active = await this.current();
      if (active.indexOf(planId) >= 0) {
        toast('This store account already has that plan. If MILES does not show it yet, tap <b>Restore purchases</b>.');
        await this.confirm();
        return false;
      }
      const options = { product };
      // On the App Store the four plans share one subscription group, and
      // Apple swaps one for another itself. Google Play would run both side by
      // side — and charge for both — unless told which one this replaces.
      if (this.platform() === 'android' && active.length) {
        options.storeProductChangeInfo = { oldProductIdentifier: active[0], replacementMode: 'WITH_TIME_PRORATION' };
      }
      try {
        await this.plugin().purchaseStoreProduct(options);
      } catch (err) {
        if (err && (err.code === CANCELLED || err.userCancelled)) return false;
        toast(esc((err && err.message) || 'The purchase did not go through. Nothing was charged.'));
        return false;
      }
      await this.confirm();
      const v = M.Pro.verify(State.data);
      toast(v.tier === 'free'
        ? 'Payment received — your plan switches on in a moment.'
        : `<b>${esc(M.Pro.PLANS[planId].name)}</b> is on. Thank you.`);
      return true;
    },

    /** Apple asks every app that sells subscriptions to offer this. */
    async restore() {
      if (!this.available()) {
        toast('Restoring purchases works in the MILES app from the App Store or Google Play.');
        return false;
      }
      try {
        await this.plugin().restorePurchases();
      } catch (err) {
        toast(esc((err && err.message) || 'The store could not be reached. Try again.'));
        return false;
      }
      await this.confirm();
      const v = M.Pro.verify(State.data);
      toast(v.tier === 'free' || v.trial
        ? 'No subscription found on this store account.'
        : `<b>${esc(v.plan ? v.plan.name : 'Your plan')}</b> restored.`);
      return true;
    },

    /** Has the server check with the store now, rather than wait for the webhook. */
    async confirm() {
      try {
        M.Sync.applyMe(await Api.post('/v1/billing/sync'));
        State.save();
      } catch (err) {
        // The webhook will still arrive; look again shortly.
        setTimeout(() => M.Sync.pullMe().then(() => State.save()).catch(() => {}), 5000);
      }
    },
  };

  M.Billing = Billing;
})(window.MILES);
