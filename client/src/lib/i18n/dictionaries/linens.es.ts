import type { linensEn } from './linens.en'

/**
 * Spanish (Latin American) strings for the linen-tracker+linen-inventory
 * surface. Typed as `typeof linensEn` so TypeScript fails the build if a key
 * is added to one dictionary and not the other. Terminology follows the
 * existing `common.es.ts` / `issues.es.ts` conventions ("Ropa de Cama" for
 * linens, "Toallas" for towels, "Propiedad" for property).
 */
export const linensEs: typeof linensEn = {
  items: {
    guest_count: 'Huéspedes',
    // Bed-size names kept as the King/Queen/Full/Twin industry terms — widely
    // used untranslated in Latin American hospitality/furniture retail too.
    king_beds: 'King',
    queen_beds: 'Queen',
    full_beds: 'Full', // REVIEW: a veces "Matrimonial" en LatAm — se mantiene "Full" por consistencia con King/Queen/Twin
    twin_beds: 'Twin', // REVIEW: a veces "Individual" en LatAm — se mantiene "Twin" por consistencia
    bath_towels: 'Toallas de Baño',
    washcloths: 'Toallitas Faciales', // REVIEW: término regional variable (toallita/paño facial)
    hand_towels: 'Toallas de Manos',
    bathmats: 'Tapetes de Baño', // REVIEW: también "alfombra de baño" en algunas regiones
    pool_towels: 'Toallas de Alberca', // REVIEW: "alberca" (México) vs. "piscina" (resto de LatAm)
    linen_notes: 'Notas',
    king_rolls: 'Rollos King',
    queen_rolls: 'Rollos Queen',
    full_rolls: 'Rollos Full',
    twin_rolls: 'Rollos Twin',
    king_top_sheets: 'Sábanas Superiores King',
    queen_top_sheets: 'Sábanas Superiores Queen',
    full_top_sheets: 'Sábanas Superiores Full',
    twin_top_sheets: 'Sábanas Superiores Twin',
    kitchen_towels: 'Toallas de Cocina',
    king_encasements: 'Forros de Colchón King', // REVIEW: término de "mattress encasement" (funda/forro/protector de colchón)
    queen_encasements: 'Forros de Colchón Queen',
    full_encasements: 'Forros de Colchón Full',
    twin_encasements: 'Forros de Colchón Twin',
    king_pillows: 'Almohadas King',
    standard_pillows: 'Almohadas Estándar',
    king_fitted_extras: 'Sábana Ajustable King (extra)',
    king_flat_extras: 'Sábana Plana King (extra)',
    king_pillowcase_extras: 'Fundas de Almohada King (extra)',
    queen_fitted_extras: 'Sábana Ajustable Queen (extra)',
    queen_flat_extras: 'Sábana Plana Queen (extra)',
    queen_pillowcase_extras: 'Fundas de Almohada Queen (extra)',
    full_fitted_extras: 'Sábana Ajustable Full (extra)',
    full_flat_extras: 'Sábana Plana Full (extra)',
    full_pillowcase_extras: 'Fundas de Almohada Full (extra)',
    twin_fitted_extras: 'Sábana Ajustable Twin (extra)',
    twin_flat_extras: 'Sábana Plana Twin (extra)',
    twin_pillowcase_extras: 'Fundas de Almohada Twin (extra)',
  },
  itemDescriptions: {
    king_rolls: '1 ajustable + 1 plana + 4 fundas de almohada',
    queen_rolls: '1 ajustable + 1 plana + 4 fundas de almohada',
    full_rolls: '1 ajustable + 1 plana + 4 fundas de almohada',
    twin_rolls: '1 ajustable + 1 plana + 2 fundas de almohada',
    kitchen_towels: '3 por cocina',
  },
  historyAbbrev: {
    king: 'King',
    queen: 'Queen',
    full: 'Full',
    twin: 'Twin',
    bath: 'Baño',
    wash: 'Facial', // REVIEW: abreviación de "washcloths" para columna angosta
    hand: 'Manos',
  },
  tracker: {
    page: {
      title: 'Requisitos de Ropa de Cama',
      subtitle: 'Propiedades activas y en incorporación - cantidades requeridas para un juego completo',
    },
    filters: {
      searchPlaceholder: 'Buscar…',
    },
    legend: {
      emptyFieldsHint: 'Campos vacíos (rojo = necesita datos)',
    },
    summary: {
      totalProperties: 'Total de Propiedades',
      setupComplete: 'Configuración Completa',
      needsSetup: 'Necesita Configuración',
    },
    badges: {
      incompleteCount: '{{count}} incompleta(s)',
    },
    actions: {
      autoFillEmptyRows: 'Autocompletar filas vacías',
      autoFillTooltip: 'Calcula los niveles Par de toallas/tapetes a partir del número de camas para cada fila que tenga camas registradas pero sin datos de toallas. Nunca modifica filas que ya tengan algún valor de toallas.',
      importCsv: 'Importar CSV',
    },
    table: {
      property: 'Propiedad',
      companyTotals: 'Totales de la Empresa ({{count}})',
    },
    empty: {
      allCompleteTitle: 'Todos los datos completos',
      allCompleteDescription: 'Todas las propiedades tienen los datos de ropa de cama completos.',
      noPropertiesTitle: 'Sin propiedades',
      noPropertiesDescription: 'No se encontraron propiedades que coincidan con tu búsqueda.',
    },
    row: {
      noDataHint: 'Sin datos de ropa de cama - todos los campos están en cero',
      autoFillAriaLabel: 'Autocompletar campos de toallas vacíos a partir de las camas',
      autoFillTooltip: 'Autocompleta los campos de toallas vacíos a partir del número de huéspedes ({{count}}). Si no hay número de huéspedes, usa el cálculo por camas. Los valores ingresados manualmente se conservan.',
      copyAriaLabel: 'Copiar datos de ropa de cama de otra propiedad',
    },
    copyDialog: {
      title: 'Copiar datos de ropa de cama a {{name}}',
      prompt: 'Selecciona una propiedad de la cual copiar los conteos de ropa de cama:',
      propertyMeta: '{{bedrooms}} HAB - {{matched}}/{{total}} campos', // REVIEW: "BR" (bedrooms) traducido como "HAB"
    },
    importDialog: {
      title: 'Importar Datos de Ropa de Cama - Vista Previa',
      matchSummary: '{{matched}} de {{total}} filas coincidieron con propiedades existentes. Las filas sin coincidencia se omitirán.',
      csvName: 'Nombre en CSV',
      matchedTo: 'Coincide Con',
      fields: 'Campos',
      status: 'Estado',
      ready: 'Listo',
      noMatch: 'Sin coincidencia',
      valuesCount: '{{count}} valores',
      importButton: 'Importar {{count}} Propiedades',
      importing: 'Importando…',
    },
    toasts: {
      saved: 'Guardado',
      updateFailed: 'Error al actualizar',
      nothingToFill: 'Nada que completar - todos los campos de toallas ya están definidos',
      autoFilledFields: 'Se autocompletaron {{count}} campo(s) (conteo de huéspedes: {{sleep}})',
      autoFillFailed: 'Error al autocompletar',
      editAccessRequired: 'Se requiere acceso de edición',
      editAccessRequiredDescription: 'No tienes acceso de edición a esta página.',
      noRowsToFill: 'No hay filas que completar',
      noRowsToFillDescription: 'Cada fila no tiene número de huéspedes/camas registrado, o ya tiene datos de toallas.',
      bulkAutoFilled: 'Se autocompletaron {{ok}} de {{total}} filas',
      csvExported: 'CSV exportado',
      csvExportedDescription: '{{count}} filas exportadas',
      csvNoData: 'No se encontraron datos en el CSV',
      csvMissingPropertyColumn: 'El CSV debe tener una columna "Property" o "Name"',
      csvNoImportable: 'No se encontraron datos importables',
      csvParseFailed: 'Error al procesar el CSV',
      importComplete: 'Importación completa',
      importCompleteDescription: '{{updated}} actualizadas, {{skipped}} omitidas',
      copyFailed: 'Error al copiar',
      copyDataSuccess: 'Datos de ropa de cama copiados',
      copyDataSuccessDescription: 'Copiado de {{from}} a {{to}}',
    },
  },
  inventory: {
    page: {
      title: 'Inventario de Ropa de Cama',
      subtitle: 'Conteos de ropa de cama de toda la empresa frente a los requisitos totales',
      lastCounted: '· Último conteo {{date}}',
    },
    tabs: {
      snapshot: 'Estado Actual',
      record: 'Registrar Conteo',
      history: 'Historial de Conteos',
    },
    empty: {
      noCountsTitle: 'Aún no hay conteos disponibles',
      noCountsDescription: 'Registra tu primer conteo de inventario para ver la variación frente al requisito de toda la empresa en esta página. Mientras tanto, las columnas "Disponible" y "Variación" mostrarán',
    },
    stats: {
      totalRequired: 'Total Requerido',
      totalOnHand: 'Total Disponible',
      overallVariance: 'Variación General',
      shortages: 'Faltantes',
    },
    table: {
      item: 'Artículo',
      required: 'Requerido',
      onHand: 'Disponible',
      variance: 'Variación',
      encasementsPillows: 'Forros y Almohadas',
      individualExtras: 'Extras Individuales',
    },
    noCount: {
      message: 'Aún no se ha registrado ningún conteo de inventario.',
      recordFirstCount: 'Registrar Primer Conteo',
    },
    labels: {
      countedBy: 'Contado Por',
    },
    record: {
      viewOnlyTitle: 'Solo Lectura',
      viewOnlyDescription: 'No tienes acceso de edición para registrar conteos.',
      enterQuantities: 'Ingresa las cantidades actuales disponibles',
      prefill: 'Precargar desde el último conteo',
      sectionRolls: 'Rollos',
      sectionTopSheets: 'Sábanas Superiores',
      sectionTowels: 'Toallas',
      sectionEncasements: 'Forros de Colchón',
      sectionPillows: 'Almohadas',
      needLabel: 'Necesario: {{count}}',
      hideExtras: 'Ocultar',
      showExtras: 'Mostrar',
      extrasToggleSuffix: 'extras individuales (ajustable, plana, fundas de almohada)',
      notesPlaceholder: 'Opcional…',
      save: 'Guardar Conteo de Inventario',
    },
    history: {
      date: 'Fecha',
      clickHint: 'Haz clic para ver todos los campos',
      emptyTitle: 'Sin historial de conteos',
      emptyDescription: 'Registra tu primer conteo de inventario para comenzar a llevar seguimiento.',
    },
    detail: {
      title: 'Detalle de conteo - {{date}}',
      countedByPrefix: 'Contado por {{name}}',
      groupSheetsTowelsKitchen: 'Sábanas, Toallas y Cocina',
      groupOnHand: 'Disponible - Forros y Almohadas',
      groupExtras: 'Extras',
    },
    csv: {
      countedAt: 'Fecha de Conteo',
    },
    toasts: {
      countSaved: 'Conteo de inventario guardado',
      saveFailed: 'Error al guardar',
      prefilled: 'Precargado desde el último conteo',
    },
  },
}
