/**
 * English strings for the Reviews surface (the /reviews page — live Hostaway
 * guest reviews proxied from Haven). Source of truth for keys;
 * `reviews.es.ts` is typed `typeof reviewsEn` so TypeScript enforces key
 * parity between the two.
 *
 * Hostaway review `status` values stay canonical English wherever they're
 * used for filtering/logic; the `status.*` namespace is a display-only slug
 * lookup (see `slugify` in `client/src/lib/issues.ts`) that falls back to the
 * raw value for any status Hostaway sends that isn't listed here.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const reviewsEn = {
  page: {
    title: 'Reviews',
    subtitle: 'Live Hostaway guest feedback from Haven - cleanliness, ratings, and response status by property.',
    searchPlaceholder: 'Property, guest, text…',
    errorTitle: "Couldn't load reviews",
    errorDescriptionFallback: 'Something went wrong fetching reviews.',
  },
  filters: {
    window: {
      d90: 'Last 90 days',
      d180: 'Last 180 days',
      d365: 'Last 12 months',
      d730: 'Last 2 years',
      all: 'All time',
    },
    rating: {
      all: 'All ratings',
      r5: '5.0 only',
      r45: '4.5+',
      r4: '4.0+',
      below4: 'Below 4.0',
      unrated: 'Unrated',
    },
    response: {
      all: 'All responses',
      responded: 'Responded',
      needsResponse: 'Needs response',
    },
    status: {
      all: 'All statuses',
    },
    sort: {
      newestDeparture: 'Newest departure',
      oldestDeparture: 'Oldest departure',
      lowestRating: 'Lowest rating',
      highestRating: 'Highest rating',
      lowestCleanliness: 'Lowest cleanliness',
      property: 'Property',
    },
  },
  tiles: {
    cleanliness: 'Cleanliness',
    cleanlinessSubtitle: '{{ten}}/10 · {{count}} rated',
    noCategoryData: 'No category data',
    avgRating: 'Avg rating',
    avgRatingSubtitle: '{{ten}}/10 raw',
    reviews: 'Reviews',
    needsResponse: 'Needs response',
    belowFour: 'Below 4.0',
    properties: 'Properties',
    noData: 'No data',
    ratedCount: '{{ten}}/10 · {{count}}',
  },
  // Category sub-score labels — keyed by the same normalized key used to
  // match Hostaway's `reviewCategory[].category` values (see
  // `normalizeCategoryKey` in reviews.tsx). Never used for data matching,
  // display only.
  categories: {
    cleanliness: 'Cleanliness',
    checkin: 'Check-in',
    communication: 'Communication',
    value: 'Value',
    location: 'Location',
    accuracy: 'Accuracy',
  },
  table: {
    departure: 'Departure',
    arrivalPrefix: 'Arr {{date}}',
    property: 'Property',
    guest: 'Guest',
    rating: 'Rating',
    cleanliness: 'Cleanliness',
    status: 'Status',
    feedback: 'Feedback',
    unknownGuest: 'Unknown',
    listingFallback: 'Listing {{id}}',
    noPublicReview: 'No public review',
    cleanPrefix: 'Clean {{score}}',
    emptyTitle: 'No matching reviews',
    emptyDescription: 'Try widening the date window or clearing filters.',
  },
  detail: {
    guest: 'Guest',
    reservation: 'Reservation',
    arrival: 'Arrival',
    departure: 'Departure',
    received: 'Received',
    listingId: 'Listing ID',
    unknownGuest: 'Unknown',
    categoryScores: 'Category scores',
    publicReview: 'Public review',
    privateFeedback: 'Private feedback',
    hostResponse: 'Host response',
    noResponseYet: 'No response yet - this review needs a reply on Hostaway.',
  },
  // Hostaway `status` field — canonical English in the DB/API. Display-only
  // slug lookup; any status not listed here falls back to the raw value.
  status: {
    published: 'Published', // REVIEW: confirm the full set of Hostaway review status values against production data
    pending: 'Pending',
    awaiting: 'Awaiting',
    expired: 'Expired',
    hidden: 'Hidden',
    draft: 'Draft',
  },
}
