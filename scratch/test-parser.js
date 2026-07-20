const { parseIngredientLine, cleanIngredientName } = require('../src/services/shopping-list-service');

const testCases = [
  {
    line: "1/4 cup fresh basil leaves, thinly sliced",
    expectedQty: "",
    expectedName: "Basil leaves"
  },
  {
    line: "garlic, finely grated",
    expectedQty: "",
    expectedName: "Garlic"
  },
  {
    line: "One 8-ounce block feta cheese, drained (see Cook’s Note)",
    expectedQty: "8 ozs",
    expectedName: "Feta cheese"
  },
  {
    line: "4 (6- to 8-oz.) boneless, skinless chicken breasts",
    expectedQty: "4",
    expectedName: "Boneless, skinless chicken breasts"
  },
  {
    line: "pints (20 ounces) cherry tomatoes",
    expectedQty: "",
    expectedName: "Cherry tomatoes"
  },
  {
    line: "Chopped fresh parsley, for serving",
    expectedQty: "",
    expectedName: "Parsley"
  },
  {
    line: "1 tsp. dried thyme",
    expectedQty: "",
    expectedName: "Thyme"
  },
  {
    line: "1/4 C. balsamic vinegar",
    expectedQty: "",
    expectedName: "Balsamic vinegar"
  },
  {
    line: "3 cloves Garlic",
    expectedQty: "",
    expectedName: "Garlic"
  }
];

console.log("=== RUNNING INGREDIENT PARSER & CLEANER TESTS ===");
let passed = true;

testCases.forEach((tc, idx) => {
  const parsed = parseIngredientLine(tc.line);
  let qtyStr = '';
  const isVolume = ['cup', 'tsp', 'tbsp', 'pinch', 'handful', 'bunch', 'pint', 'quart', 'gallon', 'clove', 'slice', 'piece'].includes(parsed.unit);
  
  // Custom quantity display rules (matching what goes to addItem)
  const isWeightOrPack = (unit) => {
    if (!unit) return false;
    const u = unit.toLowerCase();
    return ['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'ozs', 'ounce', 'ounces', 'ml', 'l', 'liter', 'liters', 'can', 'cans', 'pack', 'packs', 'tin', 'tins', 'jar', 'jars', 'bottle', 'bottles', 'bag', 'bags', 'block', 'blocks'].includes(u);
  };

  if (!isVolume && parsed.quantityValue > 0) {
    qtyStr = parsed.unit ? `${parsed.quantityValue} ${parsed.unit}s` : String(parsed.quantityValue);
  }

  const cleanName = cleanIngredientName(parsed.name);

  const qtyPass = qtyStr.trim().toLowerCase().replace('ounce', 'oz') === tc.expectedQty.trim().toLowerCase().replace('ounce', 'oz');
  const namePass = cleanName.trim().toLowerCase() === tc.expectedName.trim().toLowerCase();

  if (qtyPass && namePass) {
    console.log(`[PASS] Case ${idx + 1}: "${tc.line}"`);
  } else {
    passed = false;
    console.log(`[FAIL] Case ${idx + 1}: "${tc.line}"`);
    console.log(`   Expected: Qty: "${tc.expectedQty}", Name: "${tc.expectedName}"`);
    console.log(`   Got:      Qty: "${qtyStr}", Name: "${cleanName}" (parsed unit: "${parsed.unit}", val: ${parsed.quantityValue})`);
  }
});

if (passed) {
  console.log("\nALL TESTS PASSED SUCCESSFULLY! ✅");
} else {
  console.log("\nSOME TESTS FAILED! ❌");
}
