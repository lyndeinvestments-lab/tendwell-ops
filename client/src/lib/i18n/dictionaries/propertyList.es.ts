import type { propertyListEn } from './propertyList.en'

/**
 * Spanish (Latin American) strings for the property-list surface.
 * Terminology follows `common.es.ts`'s pipeline-stage translations
 * (Incorporación / Activa / En Salida) so the summary tiles and the
 * stage filter/badges read consistently with the rest of the app.
 */
export const propertyListEs: typeof propertyListEn = {
  page: {
    title: 'Lista de Propiedades',
    subtitle: 'Propiedades operativas - incorporación, activas y en salida',
    searchPlaceholder: 'Buscar propiedades…',
    emptyTitle: 'No se encontraron propiedades',
    emptyDescription: 'Intenta ajustar tu búsqueda o los criterios de filtro.',
  },
  tiles: {
    total: 'Propiedades Totales',
    onboarding: 'Incorporación',
    active: 'Activas',
    offboarding: 'En Salida', // REVIEW: matches common.stage.offboarding
  },
  filters: {
    allOperational: 'Todas Operativas ({{count}})',
    stageOption: '{{name}} ({{count}})',
  },
  table: {
    beds: 'Habs.',
    baths: 'Baños',
    guests: 'Huéspedes',
    sqFt: 'Pies²',
    cleanerPay: 'Pago de Limpieza',
    changeStageTooltip: 'Haz clic para cambiar la etapa',
    csv: {
      property: 'Propiedad',
      address: 'Dirección',
      bedrooms: 'Habitaciones',
      fullBaths: 'Baños Completos',
      maxGuests: 'Huéspedes Máx.',
      sqFt: 'Pies²',
      cleanerPay: 'Pago de Limpieza',
      status: 'Estado',
    },
  },
  toasts: {
    stageUpdated: 'Etapa actualizada',
    updateFailed: 'Error al actualizar',
  },
}
