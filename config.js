const parseContent = require('../../common/parsefile').parsecontent;

const hex2rgb = (hex) => {
  const [r, g, b, _] = hex.match(/\w\w/g).map((x) => parseInt(x, 16));

  return [r, g, b];
};

const coverageMapping = {
  Light: 0.6,
  Medium: 0.7,
  Full: 0.8,
};

const coverage2strength = {
  blush: 'strength',
  eyeliner: 'strength',
  eyeshadow: 'strength',
  foundation: 'coverage',
  lipliner: 'strength',
  lipstick: 'strength',
  mascara: 'strength',
  eyebrows: 'strength',
};

const finishMapping = {
  Natural: 'natural',
  Shimmering: 'shimmer',
  Matte: 'matte',
};

const tryOnCategories = {
  'MAKEUP>Augen': null,
  'MAKEUP>Augen>Augenbrauen': 'eyebrows',
  'MAKEUP>Augen>Eyeliner': 'eyeliner',
  //'MAKEUP>Eyes>Eyeshadow': 'eyeshadow',
  'MAKEUP>Augen>Mascara': 'mascara',
  'MAKEUP>Gesicht': null,
  'MAKEUP>Gesicht>Rouge': 'blush',
  'MAKEUP>Gesicht>Concealer': null,
  'MAKEUP>Gesicht>Foundation': 'foundation',
  'MAKEUP>Gesicht>Highlighter': 'blush',
  'MAKEUP>Gesicht>Puder': null,
  'MAKEUP>Lippen>Lipgloss': 'lipstick',
  'MAKEUP>Lippen>Lippenstift': 'lipstick',
};

module.exports = async () => {
  const variantData = await parseContent('../shi3rev.csv');

  const filteredProducts = variantData.map((y) => {
    const p = {
      ...y,
      coverages: y.c__coverage__default.split(';').map((z) => z.trim()),
      finishes: y.c__finish__default.split(';').map((z) => z.trim()),
      variants: y.variants.split(';').map((z) => z.trim()),
    };
    return p;
  });

  const partnerConfig = {
    partnerId: 'lS7CGtrnkY',
    file: '../latest.xml',
    // If dryRun is true, we don't insert anything into database
    // but just print the data statistics.
    dryRun: false,
    updateCategoriesFromProduct: false,
    updateExistingProductAttributes: true,
    onlyPrintResults: false,
    dataMapper: {
      class: 'CustomDataMapper',
      // Datamapper uses this to get category specific category name and
      // attribute list from categoryMap.
      getRawCategory: function (data) {
        return data.category[0].replace(/\n/g, '').trim();
      },
      // Datamapper uses this to get attribute based attributes from
      // attributeMap.
      getRawAttributes: function (data) {
        let attrs = [''];
        attrs = attrs.concat(data.skincare_concern[0].replace(/\n/g, '').trim().split(','));
        attrs = attrs.concat(data.skin_type[0].replace(/\n/g, '').trim().split(','));
        attrs = attrs.concat(data.finish[0].replace(/\n/g, '').trim().split(','));
        attrs = attrs.concat(data.coverage[0].replace(/\n/g, '').trim().split(','));
        return attrs;
      },
      // Tell Datamapper where is the product array
      filter: function (data) {
        const finalProducts = [];
        data.products.product.map((prodRow) => {
          if (prodRow.declinaisons && prodRow.declinaisons[0].declinaison) {
            prodRow.declinaisons[0].declinaison.map((d, i) => {
              let merged = Object.assign({}, JSON.parse(JSON.stringify(prodRow)), d);
              merged.name[0] = merged.name[0].replace(/\n/g, '').trim(); // + '-' + i;
              delete merged.declinaisons;
              finalProducts.push(merged);
            });
          } else {
            finalProducts.push(prodRow);
          }
        });

        return finalProducts;
      },
      // If the DataMapper subclass fails to find some fields, you can customize
      // it here. Also handy for adding partner specific custom_data based on
      // your own rules.
      fieldMappingOverrides: function (raw) {
        const category = raw.category[0].replace(/\n/g, '').trim();
        const tryOnCategory = tryOnCategories[category];
        const product_id = raw.id[0].replace(/\n/g, '').trim();
        const parent = filteredProducts.find((e) => e.variants.includes(product_id));

        //  const makeUpData = filteredProducts.find((e) => e.ID === product_id);
        // const hexColor = makeUpData.c__colorHex;
        //const colors = hexColor && makeUpData.c__colorHex.split(';').map((x) => hex2rgb(x.trim()));

        const coverage = parent && parent.coverages[0].trim();
        const finish = parent && parent.finishes[0].trim();
        const variant_name = raw.attributs && raw.attributs[0].color[0].replace(/\n/g, '').trim();

        const try_on = tryOnCategory && {
          [tryOnCategory]: {
            enabled: true,
            //  ...(colors.length > 0 && { color: colors[0] }),
            //...(colors.length > 0 && tryOnCategory === 'eyeshadow' && { color: colors.slice(0, 3) }),
            ...(coverage && { [coverage2strength[tryOnCategory]]: coverageMapping[coverage] }),
            ...(finish && { finish: finishMapping[finish] }),
            ...((!finish || finishMapping[finish] === 'shimmer') &&
              tryOnCategory === 'lipstick' && { finish: 'satin' }),
            ...(!finish && category === 'MAKEUP>Lippen>Lipgloss' && { finish: 'gloss' }),
          },
        };

        let product = {
          product_name: raw.name[0],
          description: raw.short_description[0].replace(/\n/g, '').trim(),
          manufacturer: raw.brand[0].replace(/\n/g, '').trim(),
          product_id,
          parent_id: parent ? parent.variants[0].split(';')[0] : product_id,
          url: raw.link[0].replace(/\n/g, '').trim(),
          image: raw.images[0].image[0].replace(/\n/g, '').trim(),
          price: parseFloat(raw.price[0]),
          gtin: raw.ean[0].replace(/\n/g, '').trim(),
          available: parent && parent.variants[0].split(';')[0] === product_id ? true : raw.quantity[0] > 0,
          // ...(try_on && { try_on }),
        };

        let custom_data = {
          ...(variant_name !== 'n/a' && { variant_name }),
        };
        const usetime = raw.regimen_time_use[0].replace(/\n/g, '').trim();
        if (usetime.length > 0) {
          custom_data.usetime = usetime;
        }

        const formula = raw.formula[0].replace(/\n/g, '').trim();
        if (formula.length > 0) {
          custom_data.formula = formula;
        }
        product.custom_data = custom_data;

        return product;
      },
      // Mapping of raw categories to our categories and attributes
      attributeMap: {
        __default: { category: null, attributes: ['female'] },
        '': { category: null, attributes: [] },
        'All Skin Types': { category: null, attributes: ['all_skin_types'] },
        Combination: { category: null, attributes: ['combination_skin'] },
        Dry: { category: null, attributes: ['dry_skin'] },
        Full: { category: null, attributes: ['full_coverage'] },
        Light: { category: null, attributes: ['light_coverage'] },
        Luminous: { category: null, attributes: ['luminous_finish'] },
        Matte: { category: null, attributes: ['matte_finish'] },
        Medium: { category: null, attributes: ['medium_coverage'] },
        'Medium to Full': { category: null, attributes: ['medium_coverage'] },
        Natural: { category: null, attributes: ['natural_finish'] },
        Normal: { category: null, attributes: ['normal_skin'] },
        Oily: { category: null, attributes: ['oily_skin'] },
        Sensitive: { category: null, attributes: ['sensitive_skin'] },
        Shimmering: { category: null, attributes: ['shimmer_finish'] },
        SPF: { category: null, attributes: ['sun_protection'] },
      },
      categoryMap: {
        __default: { category: null, attributes: ['female'] },
        __no_match: { category: null, attributes: ['skip_this_product'] },
        MAKEUP: { category: null, attributes: [] },
        'MAKEUP>Augen': { category: 'Eyes', attributes: [] },
        'MAKEUP>Augen>Augenbrauen': { category: 'Eyebrows', attributes: [] },
        'MAKEUP>Augen>Eyeliner': { category: 'Eyeliner', attributes: [] },
        'MAKEUP>Augen>Mascara': { category: 'Mascara', attributes: [] },
        'MAKEUP>Gesicht': { category: null, attributes: [] },
        'MAKEUP>Gesicht>Concealer': { category: 'Concealer', attributes: [] },
        'MAKEUP>Gesicht>Foundation': { category: 'Foundation', attributes: [] },
        'MAKEUP>Gesicht>Highlighter': { category: 'Highlighter', attributes: [] },
        'MAKEUP>Gesicht>Puder': { category: 'Powder', attributes: [] },
        'MAKEUP>Gesicht>Rouge': { category: 'Blush', attributes: [] },
        'MAKEUP>Lippen>Lipgloss': { category: 'Lip Gloss', attributes: [] },
        'MAKEUP>Lippen>Lippenstift': { category: 'Lipstick', attributes: [] },
        'MAKEUP>Tools & Accessoires>Blotting Paper': { category: null, attributes: ['skip_this_product'] },
        'MAKEUP>Tools & Accessoires>Pinsel': { category: null, attributes: ['skip_this_product'] },
      },
    },
  };

  return partnerConfig;
};
