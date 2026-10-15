/**
 * English strings for the Reviews surface (the /reviews page: guest reviews
 * from Haven's Trellis, each matched to the clean that prepared the stay).
 * Source of truth for keys; `reviews.es.ts` is typed `typeof reviewsEn` so
 * TypeScript enforces key parity between the two.
 *
 * Source/attribution values stay canonical in the data; the `sources.*` and
 * `attribution.*` namespaces are display-only lookups.
 */
// Deliberately NOT `as const`: see issues.en.ts for the parity rationale.
export const reviewsEn = {
  page: {
    title: 'Reviews',
    subtitle: 'Guest reviews from Haven, matched to the clean that prepared each stay.',
    searchPlaceholder: 'Property, guest, cleaner, text…',
    errorTitle: "Couldn't load reviews",
    errorDescriptionFallback: 'Something went wrong fetching reviews.',
    dataNote: 'From Trellis, refreshed every 4 hours. A stay is credited to the last completed clean at the property in the 14 days before check-in.',
  },
  filters: {
    window: {
      d30: 'Last 30 days',
      d90: 'Last 90 days',
      d180: 'Last 180 days',
      d365: 'Last 12 months',
      custom: 'Custom range',
    },
    from: 'From',
    to: 'To',
    rating: {
      all: 'All ratings',
      r5: '5 stars',
      r4plus: '4 stars and up',
      below4: 'Below 4 stars',
      below3: 'Below 3 stars',
    },
    source: {
      all: 'All channels',
    },
    property: {
      placeholder: 'All properties',
      search: 'Search properties…',
      empty: 'No property found.',
    },
    attribution: {
      ops: 'All Ops properties',
      tendwell: 'Tendwell-cleaned only',
      cleaner: 'Named cleaner',
      tendwell_crew: 'Tendwell crew (no name)',
      not_tendwell: 'Not a Tendwell clean',
      no_clean: 'No clean found',
      not_in_ops: 'Not an Ops property',
      all: 'Everything',
    },
    lowCleanliness: 'Low cleanliness only',
    sort: {
      newest: 'Newest review',
      oldest: 'Oldest review',
      lowestRating: 'Lowest rating',
      lowestCleanliness: 'Lowest cleanliness',
      property: 'Property',
    },
    clear: 'Clear filters',
  },
  tiles: {
    reviews: 'Reviews',
    reviewsSubtitle: '{{count}} properties',
    avgRating: 'Avg rating',
    ratedSubtitle: '{{count}} rated',
    cleanliness: 'Avg cleanliness',
    lowCleanliness: 'Low cleanliness',
    lowCleanlinessSubtitle: '{{count}} below 4 stars',
    tendwellCleaned: 'Tendwell-cleaned',
    tendwellSubtitle: '{{named}} with a named cleaner',
    noData: 'No data',
  },
  compare: {
    line: 'Cleanliness after Tendwell cleans: {{tw}} ({{twCount}} reviews). After other cleans: {{other}} ({{otherCount}} reviews).',
  },
  attribution: {
    cleaner: 'Prepared by {{name}}',
    tendwell_crew: 'Tendwell crew',
    not_tendwell: 'Not a Tendwell clean',
    no_clean_found: 'No clean found',
    no_checkin: 'No check-in date',
    no_ops_property: 'Not an Ops property',
    cleanOn: 'Clean {{date}}',
  },
  categories: {
    cleanliness: 'Cleanliness',
    checkin: 'Check-in',
    communication: 'Communication',
    value: 'Value',
    location: 'Location',
    accuracy: 'Accuracy',
  },
  sources: {
    AIRBNB: 'Airbnb',
    BOOKING: 'Booking.com',
    VRBO: 'Vrbo',
    DIRECT: 'Direct',
  },
  table: {
    reviewed: 'Reviewed',
    property: 'Property',
    guest: 'Guest',
    rating: 'Rating',
    cleanliness: 'Cleanliness',
    preparedBy: 'Prepared by',
    feedback: 'Review',
    stay: 'Stay {{checkin}} to {{checkout}}',
    unknownGuest: 'Unknown guest',
    noText: 'No written review',
    emptyTitle: 'No matching reviews',
    emptyDescription: 'Try widening the date range or clearing filters.',
    showing: 'Showing {{shown}} of {{total}}',
    showMore: 'Show more',
  },
  detail: {
    guest: 'Guest',
    reservation: 'Reservation',
    checkin: 'Check-in',
    checkout: 'Check-out',
    reviewed: 'Reviewed',
    source: 'Channel',
    cleanTitle: 'Clean',
    cleanDate: 'Clean date',
    preparedBy: 'Prepared by',
    categoryScores: 'Category scores',
    review: 'Review',
    hostResponse: 'Host response',
    responded: 'Responded',
    notResponded: 'No response recorded',
    openProperty: 'Open property',
    attributionHelp: 'The clean that prepared this stay is the last completed clean at the property in the 14 days before check-in.',
  },
}
