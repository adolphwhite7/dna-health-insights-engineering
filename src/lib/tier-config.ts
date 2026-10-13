/**
 * Tier Configuration - Single Source of Truth
 *
 * Functional names: Used in legal pages, checkout flows, invoices, Stripe products
 * Marketing names: Used on homepage, pricing page, promotional content
 *
 * JIRA: DNA-621, DNA-622
 */

export type TierId = 'tier1' | 'tier2' | 'tier3';

export type BillingCycle = 'monthly' | 'annual';

export interface PricingInfo {
  monthly?: number;
  annual?: number;
  oneTime?: number;
}

export interface TierConfig {
  id: TierId;
  functionalName: string;
  marketingName: string;
  description: string;
  pricing: PricingInfo;
  features: {
    included: string[];
    notIncluded?: string[];
  };
  badge?: string;
  popular?: boolean;
}

export const TIER_CONFIG: Record<TierId, TierConfig> = {
  tier1: {
    id: 'tier1',
    functionalName: 'The Blueprint',
    marketingName: 'The Blueprint',
    description:
      'A thorough first reading of your DNA, with clear context for lifestyle, medication response, and clinical conversations.',
    pricing: {
      oneTime: 49,
    },
    features: {
      included: [
        'Your Genome Snapshot and Welcome Reading',
        'Lifestyle and nutrition context',
        'Medication-response insights',
        'Clinical context for discussion',
        'Clear explanations grounded in science',
        'Downloadable PDF to keep',
      ],
    },
    badge: 'One-time',
  },
  tier2: {
    id: 'tier2',
    functionalName: 'The Living Blueprint',
    marketingName: 'The Living Blueprint',
    description:
      'Keep your DNA insights current, explore them around the goals you care about, and create one fresh personalized summary each month.',
    pricing: {
      monthly: 12.99,
      annual: 99,
    },
    features: {
      included: [
        'Everything in The Blueprint',
        'A visual map of key DNA insights',
        'New science and research updates',
        'Insights organized around your goals',
        '1 fresh personalized summary monthly',
        'Saved summaries and downloadable reports',
      ],
    },
    badge: 'Most Popular',
    popular: true,
  },
  tier3: {
    id: 'tier3',
    functionalName: 'Performance Suite',
    marketingName: 'Performance Suite',
    description:
      'See the full picture in your DNA, with deeper explanations, supplement context, and more ways to explore what matters to you.',
    pricing: {
      monthly: 19.99,
      annual: 149,
    },
    features: {
      included: [
        'Everything in The Living Blueprint',
        'Your complete DNA insight picture',
        'Deeper explanations for every result',
        'Goal-based views and supplement context',
        '4 fresh personalized summaries each month',
        'Full report library and downloadable PDFs',
      ],
    },
  },
};

export function formatPrice(price: number): string {
  return `$${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

export function getTierPrice(tier: TierConfig, cycle: BillingCycle): string {
  if (tier.pricing.oneTime) {
    return formatPrice(tier.pricing.oneTime);
  }
  const price = cycle === 'monthly' ? tier.pricing.monthly : tier.pricing.annual;
  return price ? formatPrice(price) : 'N/A';
}

export function getTierBillingLabel(tier: TierConfig, cycle: BillingCycle): string {
  if (tier.pricing.oneTime) {
    return 'one-time';
  }
  return cycle === 'monthly' ? '/month' : '/year';
}

/**
 * Sanitizes customer-facing tier copy to respect marketing-copy discipline and
 * legal boundaries. Pricing owns the canonical copy; Analyze reuses this helper
 * so descriptions/features do not drift by route.
 */
export function sanitizeTierMarketingCopy(copy: string): string {
  return copy
    .replace(/ClinVar/gi, 'curated databases')
    .replace(/PharmGKB|OMIM|dbSNP|GnomAD/gi, 'public genetics sources')
    .replace(/Clinical Insights/gi, 'Genetic Insights')
    .replace(/Clinical analysis/gi, 'Genetic analysis')
    .replace(/Clinical and pharmacogenomic/gi, 'Genetic and pharmacogenomic')
    .replace(/Health Architect/gi, 'Performance Architect');
}

export function getTierDisplayDescription(tierId: TierId): string {
  return sanitizeTierMarketingCopy(TIER_CONFIG[tierId].description);
}

export function getTierIncludedFeatures(tierId: TierId): string[] {
  return TIER_CONFIG[tierId].features.included.map(sanitizeTierMarketingCopy);
}

export function getTierNotIncludedFeatures(tierId: TierId): string[] {
  return (TIER_CONFIG[tierId].features.notIncluded ?? []).map(
    sanitizeTierMarketingCopy,
  );
}

/**
 * Format tier price for the tier switcher panel display
 * Returns exact strings from TIER_CONFIG, including annual cadence where offered.
 */
export function formatTierPrice(tierId: TierId): string {
  const tier = TIER_CONFIG[tierId];
  if (tier.pricing.oneTime) {
    return `${formatPrice(tier.pricing.oneTime)} one-time`;
  }
  return [
    tier.pricing.monthly ? `${formatPrice(tier.pricing.monthly)} / month` : null,
    tier.pricing.annual ? `${formatPrice(tier.pricing.annual)} / year` : null,
  ]
    .filter(Boolean)
    .join(' or ');
}

/**
 * Format CTA label for tier switcher
 * Returns labels from TIER_CONFIG, including annual cadence where offered.
 */
export function formatTierCtaLabel(tierId: TierId): string {
  const tier = TIER_CONFIG[tierId];
  const monthlyOrAnnual = [
    tier.pricing.monthly ? `${formatPrice(tier.pricing.monthly)}/mo` : null,
    tier.pricing.annual ? `${formatPrice(tier.pricing.annual)}/yr` : null,
  ]
    .filter(Boolean)
    .join(' or ');

  switch (tierId) {
    case 'tier1':
      return `Get Blueprint — ${formatPrice(tier.pricing.oneTime ?? 0)}`;
    case 'tier2':
      return `Start Living — ${monthlyOrAnnual}`;
    case 'tier3':
      return `Start Performance — ${monthlyOrAnnual}`;
    default:
      return '';
  }
}
