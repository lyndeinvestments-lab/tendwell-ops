import type { shipmentsEn } from './shipments.en'

/**
 * Spanish (Latin American) strings for the incoming-shipments+shipment-report
 * surface. `delivery_responsible` ('Haven'/'Tendwell') is left untranslated
 * everywhere — those are company names, not generic words.
 */
export const shipmentsEs: typeof shipmentsEn = {
  page: {
    title: 'Envíos Entrantes',
    subtitle: 'Envíos desde el formulario público de reporte · se actualiza automáticamente cada 30s',
    searchPlaceholder: 'Buscar remitente, propiedad, descripción, número de seguimiento…',
    allParties: 'Todas las partes',
    errorDescription: 'No se pudieron cargar los Envíos Entrantes: {{message}}',
  },
  table: {
    headers: {
      sender: 'Remitente',
      description: 'Descripción',
      tracking: 'Seguimiento', // REVIEW: short column header — "Rastreo" is another common LatAm option
      estDelivery: 'Entrega Est.',
      responsible: 'Responsable',
      submitted: 'Enviado',
    },
    empty: 'Ningún envío coincide con tus filtros.',
    markReceived: 'Marcar recibido',
    undo: 'Deshacer',
  },
  status: {
    pending: 'Pendiente',
    received: 'Recibido',
  },
  form: {
    markReceivedTitle: 'Marcar envío como recibido',
    markReceivedFallback: 'Confirma que el paquete ha llegado físicamente.',
    notesLabel: 'Notas (opcional)',
    notesPlaceholder: 'Cualquier cosa que valga la pena anotar: daños, ubicación, quién lo entregó…',
    detailsTitle: 'Detalles del envío',
    submittedAt: 'Enviado {{time}}',
    trackingNumber: 'N.º de seguimiento',
    estimatedDelivery: 'Entrega estimada',
    deliveryResponsible: 'Responsable de la entrega',
    receivedAt: 'Recibido {{time}}',
    receivedBy: '· por {{name}}',
  },
  toasts: {
    markedReceived: 'Marcado como recibido',
    markReceivedFailed: 'No se pudo marcar como recibido',
    movedToPending: 'Devuelto a pendiente',
    undoFailed: 'No se pudo deshacer',
    unknownError: 'Error desconocido',
  },
  report: {
    title: 'Reportar Envío Entrante',
    subtitle: 'Avísanos sobre un envío en camino a nuestras instalaciones.',
    yourName: 'Tu Nombre',
    yourNamePlaceholder: 'Nombre y apellido',
    propertyPlaceholder: 'Buscar propiedad…',
    trackingNumber: 'Número de Seguimiento',
    optional: '(opcional)',
    trackingPlaceholder: 'ej. 1Z999AA10123456784',
    estimatedDeliveryDate: 'Fecha Estimada de Entrega',
    descriptionOfItem: 'Descripción del Artículo',
    descriptionPlaceholder: 'Describe el/los artículo(s) que se están enviando…',
    responsibleQuestion: '¿Quién es responsable de la entrega en la propiedad?',
    validationRequired: 'Por favor completa todos los campos requeridos.',
    validationGeneric: 'Algo salió mal. Inténtalo de nuevo.',
    submit: 'Enviar Reporte de Envío',
    submitting: 'Enviando…',
    footer: 'Tendwell Operations', // REVIEW: kept as English brand tag, mirrors "Tendwell Cleaning Co." staying English in weighIns.es.ts
    successTitle: 'Envío Reportado',
    successBody: '¡Gracias! Tu reporte de envío ha sido recibido. Estaremos atentos.',
    submitAnother: 'Enviar Otro',
  },
}
