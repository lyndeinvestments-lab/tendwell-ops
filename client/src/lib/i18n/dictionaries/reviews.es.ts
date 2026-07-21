import type { reviewsEn } from './reviews.en'

/**
 * Spanish (Latin American) strings for the Reviews surface. Terminology kept
 * consistent with the rest of the app: "Reseñas" for reviews, "Limpieza" for
 * cleanliness, "Propiedad" for property, "Huésped" for guest.
 */
export const reviewsEs: typeof reviewsEn = {
  page: {
    title: 'Reseñas',
    subtitle: 'Comentarios de huéspedes de Hostaway en vivo desde Haven - limpieza, calificaciones y estado de respuesta por propiedad.',
    searchPlaceholder: 'Propiedad, huésped, texto…',
    errorTitle: 'No se pudieron cargar las reseñas',
    errorDescriptionFallback: 'Algo salió mal al obtener las reseñas.',
  },
  filters: {
    window: {
      d90: 'Últimos 90 días',
      d180: 'Últimos 180 días',
      d365: 'Últimos 12 meses',
      d730: 'Últimos 2 años',
      all: 'Todo el tiempo',
    },
    rating: {
      all: 'Todas las calificaciones',
      r5: 'Solo 5.0',
      r45: '4.5+',
      r4: '4.0+',
      below4: 'Menos de 4.0',
      unrated: 'Sin calificar',
    },
    response: {
      all: 'Todas las respuestas',
      responded: 'Respondida',
      needsResponse: 'Necesita respuesta',
    },
    status: {
      all: 'Todos los estados',
    },
    sort: {
      newestDeparture: 'Salida más reciente',
      oldestDeparture: 'Salida más antigua',
      lowestRating: 'Calificación más baja',
      highestRating: 'Calificación más alta',
      lowestCleanliness: 'Limpieza más baja',
      property: 'Propiedad',
    },
  },
  tiles: {
    cleanliness: 'Limpieza',
    cleanlinessSubtitle: '{{ten}}/10 · {{count}} calificadas',
    noCategoryData: 'Sin datos de categoría',
    avgRating: 'Calificación promedio',
    avgRatingSubtitle: '{{ten}}/10 en bruto', // REVIEW: "en bruto" vs "sin procesar" for "raw"
    reviews: 'Reseñas',
    needsResponse: 'Necesita respuesta',
    belowFour: 'Menos de 4.0',
    properties: 'Propiedades',
    noData: 'Sin datos',
    ratedCount: '{{ten}}/10 · {{count}}',
  },
  categories: {
    cleanliness: 'Limpieza',
    checkin: 'Registro de entrada',
    communication: 'Comunicación',
    value: 'Valor',
    location: 'Ubicación',
    accuracy: 'Precisión',
  },
  table: {
    departure: 'Salida',
    arrivalPrefix: 'Lleg {{date}}',
    property: 'Propiedad',
    guest: 'Huésped',
    rating: 'Calificación',
    cleanliness: 'Limpieza',
    status: 'Estado',
    feedback: 'Comentarios',
    unknownGuest: 'Desconocido',
    listingFallback: 'Anuncio {{id}}',
    noPublicReview: 'Sin reseña pública',
    cleanPrefix: 'Limpieza {{score}}',
    emptyTitle: 'No hay reseñas coincidentes',
    emptyDescription: 'Prueba ampliar el rango de fechas o borrar los filtros.',
  },
  detail: {
    guest: 'Huésped',
    reservation: 'Reserva',
    arrival: 'Llegada',
    departure: 'Salida',
    received: 'Recibida',
    listingId: 'ID del anuncio',
    unknownGuest: 'Desconocido',
    categoryScores: 'Puntuaciones por categoría',
    publicReview: 'Reseña pública',
    privateFeedback: 'Comentarios privados',
    hostResponse: 'Respuesta del anfitrión',
    noResponseYet: 'Aún sin respuesta - esta reseña necesita una respuesta en Hostaway.',
  },
  status: {
    published: 'Publicada', // REVIEW: confirm the full set of Hostaway review status values against production data
    pending: 'Pendiente',
    awaiting: 'En espera',
    expired: 'Vencida',
    hidden: 'Oculta',
    draft: 'Borrador',
  },
}
