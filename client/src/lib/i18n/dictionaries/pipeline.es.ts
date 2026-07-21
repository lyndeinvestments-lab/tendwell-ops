import type { pipelineEn } from './pipeline.en'

/** Spanish (Latin American) strings for the pipeline surface. */
export const pipelineEs: typeof pipelineEn = {
  page: {
    title: 'Pipeline',
    subtitle: 'Arrastra las propiedades entre etapas',
    profitLegend: 'leyenda de ganancias',
    searchPlaceholder: 'Buscar propiedades...',
    clearSearch: 'Borrar búsqueda',
    addLead: 'Agregar Prospecto', // REVIEW: "Lead" — team may prefer to keep "Lead" untranslated
    compact: 'Compacto',
    compactTooltip: 'Mostrar tarjetas con menos detalle',
    hideEmpty: 'Ocultar vacías',
    scrollToTop: 'Ir arriba',
  },
  board: {
    expandColumn: 'Expandir columna {{stage}}',
    collapseColumn: 'Contraer columna {{stage}}',
    propertiesCount: '{{count}} propiedades',
    mobileStageOption: '{{stage}} ({{count}})',
  },
  card: {
    stale: 'Estancado', // REVIEW: "Stale" (no follow-up in 14+ days) — confirm preferred term
    inStageSince: 'En {{stage}} desde {{date}}',
    followUp: 'Seguimiento:',
    followUpAria: 'Fecha de seguimiento para {{name}}',
    addFollowUp: 'Agregar seguimiento',
    payment: 'Pago: {{method}}',
    clientSince: 'Cliente desde {{date}}',
    cleanerPay: 'Pago: {{amount}}',
    onboardingTasks: '{{completed}} de {{total}} tareas',
    setupChecklist: 'Lista de configuración →',
    stageHistory: 'Historial de Etapas',
    noData: 'Sin datos',
    profitTier: {
      high: 'Ganancia alta',
      mid: 'Ganancia media',
      low: 'Ganancia baja',
    },
  },
  addLead: {
    dialogTitle: 'Agregar Nuevo Prospecto', // REVIEW: "Lead"
    nameLabel: 'Nombre de la Propiedad *',
    namePlaceholder: 'Ingresa el nombre de la propiedad',
    duplicateWarning: 'Ya existe una propiedad llamada "{{name}}". ¿Crear de todas formas?',
    addressLabel: 'Dirección de la Propiedad',
    addressPlaceholder: 'Ingresa la dirección de la propiedad',
    emailLabel: 'Correo',
    emailPlaceholder: 'owner@example.com',
    phoneLabel: 'Teléfono',
    phonePlaceholder: '(555) 000-0000',
    bedroomsLabel: 'Habitaciones Estimadas',
    bedroomsPlaceholder: 'ej. 3',
    sourceLabel: 'Fuente',
    sourcePlaceholder: 'Seleccionar fuente',
    sourceReferral: 'Referido',
    sourceWebsite: 'Sitio Web',
    sourceColdOutreach: 'Contacto en Frío', // REVIEW: "Cold Outreach"
    sourceWordOfMouth: 'Boca a Boca',
    sourceOther: 'Otro',
    notesLabel: 'Notas',
    notesPlaceholder: 'Notas adicionales...',
    cancel: 'Cancelar',
    save: 'Agregar Prospecto', // REVIEW: "Lead"
    saving: 'Guardando...',
  },
  toasts: {
    moveFailed: 'Error al mover la propiedad',
    followUpFailed: 'Error al guardar la fecha de seguimiento',
    leadAdded: 'Prospecto agregado al pipeline', // REVIEW: "Lead" / "pipeline"
    addLeadErrorPrefix: 'Error: ',
    addLeadErrorFallback: 'Error al agregar el prospecto',
  },
}
