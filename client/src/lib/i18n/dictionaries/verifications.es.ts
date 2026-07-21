import type { verificationsEn } from './verifications.en'

/** Spanish (Latin American) strings for the property-verifications surface. */
export const verificationsEs: typeof verificationsEn = {
  page: {
    title: 'Verificación de Propiedades',
    subtitle: 'Verifica los detalles de la propiedad cada 6 meses - haz clic en una propiedad para iniciar el recorrido',
    needsVerification: '{{count}} necesita(n) verificación',
    searchPlaceholder: 'Buscar…',
  },
  tiles: {
    totalProperties: 'Propiedades Totales',
    verified: 'Verificado',
    needsVerification: 'Necesita Verificación',
    overdue: 'Vencido',
  },
  bulk: {
    selected: '{{count}} seleccionado(s)',
    assign: 'Asignar',
    clearAssignment: 'Quitar asignación',
    setDueDate: 'Establecer fecha límite',
    apply: 'Aplicar',
    plusOneMonth: '+1mes',
    markVerified: 'Marcar como verificado',
    clear: 'Borrar',
  },
  table: {
    selectAllAria: 'Seleccionar todo',
    selectRowAria: 'Seleccionar {{name}}',
    property: 'Propiedad',
    status: 'Estado',
    assignee: 'Asignado a',
    due: 'Vence',
    lastVerified: 'Última Verificación',
    verifiedBy: 'Verificado Por',
    action: 'Acción',
    daysAgo: '(hace {{count}}d)',
    emptyAllVerifiedTitle: 'Todo verificado',
    emptyAllVerifiedDescription: 'Todas las propiedades han sido verificadas en los últimos 6 meses.',
    emptyNoPropertiesTitle: 'Sin propiedades',
    emptyNoPropertiesDescription: 'No se encontraron propiedades que coincidan con tu búsqueda.',
    verify: 'Verificar',
    reVerify: 'Re-verificar',
  },
  // REVIEW: `status.due` (6-month verification interval elapsed) and
  // `tiles.overdue` (assigned due_date passed) are distinct business concepts
  // that both read naturally as "Vencido" in Spanish — kept as one word each
  // per the single-word badge/tile UI; flag if a reviewer wants them
  // disambiguated (e.g. "Pendiente" for the row badge).
  status: {
    verified: 'Verificado',
    due: 'Vencido',
    never: 'Nunca',
  },
  toasts: {
    editAccessRequired: 'Acceso de edición requerido',
    editAccessDescription: 'No tienes acceso de edición a esta página.',
    updatePropertyFailed: 'Error al actualizar la propiedad',
    saveVerificationFailed: 'Error al guardar la verificación',
    verificationComplete: 'Verificación completada',
    fieldsUpdated: '{{count}} campo(s) actualizado(s)',
    allInfoConfirmed: 'Toda la información confirmada',
    unexpectedError: 'Error inesperado al guardar la verificación',
    tryAgain: 'Por favor, inténtalo de nuevo.',
    bulkAssignFailed: 'Error al asignar en lote',
    assignedTo: '{{count}} asignado(s) a {{name}}',
    clearedAssignment: 'Asignación eliminada en {{count}}',
    bulkScheduleFailed: 'Error al programar en lote',
    setDueDateOn: 'Fecha límite establecida en {{count}}',
    bulkVerifyFailed: 'Error al verificar en lote',
    markedVerified: '{{count}} marcado(s) como verificado(s)',
    clearFailed: 'Error al borrar',
  },
  confirm: {
    bulkMarkVerified: '¿Marcar {{count}} como verificado(s) ahora? Esto no actualizará los campos de la propiedad, solo el registro de verificación.',
    unsavedChanges: 'Tienes cambios sin guardar. ¿Cerrar sin guardar?',
  },
  csv: {
    headerDaysSince: 'Días Transcurridos',
  },
  form: {
    sections: {
      propertyDetails: 'Detalles de la Propiedad',
      bedCounts: 'Cantidad de Camas',
      accessWifi: 'Acceso y Wi-Fi',
      operations: 'Operaciones',
    },
    fields: {
      address: 'Dirección',
      bedrooms: 'Habitaciones',
      full_baths: 'Baños Completos',
      half_baths: 'Medios Baños',
      // REVIEW: "square footage" — kept as pies cuadrados (US unit); flag if
      // properties should display metros cuadrados instead.
      square_footage: 'Pies Cuadrados',
      guest_count: 'Máximo de Huéspedes',
      // REVIEW: "Jacuzzi" is the common colloquial term across Latin
      // American Spanish for an in-unit hot tub; "Tina Caliente" is more
      // literal but less natural in this operational context.
      hot_tub: 'Jacuzzi',
      pet_friendly: 'Admite Mascotas',
      // REVIEW: bed-size terms (King/Queen/Full/Twin) are kept as the
      // English loanwords used throughout US hospitality/Spanish, matching
      // how cleaners and owners already refer to them in practice.
      king_beds: 'Camas King',
      queen_beds: 'Camas Queen',
      full_beds: 'Camas Full',
      twin_beds: 'Camas Twin',
      number_of_beds: 'Total de Camas',
      // REVIEW: "Auto Code" is internal operational jargon (auto-lock code?)
      // — translated literally; confirm the intended meaning with ops.
      auto_code: 'Código Automático',
      door_code: 'Código de la Puerta',
      other_codes: 'Otros Códigos',
      wifi_info: 'Información de Wi-Fi',
      filter_size: 'Tamaño del Filtro de A/C',
      cleaning_frequency: 'Frecuencia de Limpieza',
      notes: 'Notas Especiales',
    },
    noAddress: 'Sin dirección',
    confirmVerification: 'Confirmar Verificación',
    viewOnly: 'Solo Lectura',
  },
}
