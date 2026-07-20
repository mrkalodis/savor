// Savor Smart Substitutions Engine
'use strict';

const substitutionData = [
  {
    ingredient: "Egg (for baking)",
    substitutes: [
      { name: "Applesauce", quantity: "1/4 cup unsweetened applesauce per egg", notes: "Best for cakes, muffins, and quick breads. Keeps baking moist." },
      { name: "Banana", quantity: "1/4 cup mashed ripe banana per egg", notes: "Best for chewy cookies and pancakes. Adds a distinct banana flavor." },
      { name: "Flaxseed Meal", quantity: "1 tbsp flax meal + 3 tbsp warm water", notes: "Whisk and let sit for 5 mins to gel. Best for nut-flavored or rustic baked goods." },
      { name: "Chia Seeds", quantity: "1 tbsp chia seeds + 3 tbsp water", notes: "Let sit to form a gel. Works best in muffins and waffles." }
    ]
  },
  {
    ingredient: "Buttermilk",
    substitutes: [
      { name: "Milk + Lemon/Vinegar", quantity: "1 cup milk + 1 tbsp lemon juice or white vinegar", notes: "Let stand for 5-10 minutes until slightly curdled and soured." },
      { name: "Milk + Cream of Tartar", quantity: "1 cup milk + 1.75 tsp cream of tartar", notes: "Whisk together. Good substitute when acid is needed for leavening." },
      { name: "Yogurt", quantity: "3/4 cup plain yogurt + 1/4 cup milk/water", notes: "Whisk until smooth and liquid." }
    ]
  },
  {
    ingredient: "Butter (for baking)",
    substitutes: [
      { name: "Coconut Oil", quantity: "1:1 ratio replacement", notes: "Use solid or melted as required by recipe. Adds a subtle coconut note." },
      { name: "Applesauce", quantity: "Replace up to half of butter 1:1", notes: "Reduces fat content. Replaces texture but changes crumb density." },
      { name: "Vegetable/Canola Oil", quantity: "7/8 cup oil per 1 cup butter", notes: "Only use if recipe calls for melted butter." }
    ]
  },
  {
    ingredient: "Heavy Cream",
    substitutes: [
      { name: "Milk + Butter", quantity: "3/4 cup milk + 1/4 cup melted butter", notes: "Thoroughly whisk together. Best for cooking/baking; cannot be whipped." },
      { name: "Coconut Cream", quantity: "1:1 ratio replacement", notes: "Chill canned coconut milk overnight, scoop solid cream off top. CAN be whipped!" },
      { name: "Evaporated Milk", quantity: "1:1 ratio replacement", notes: "Best for soups, sauces, and slow cooker meals." }
    ]
  },
  {
    ingredient: "Lemon Juice",
    substitutes: [
      { name: "Lime Juice", quantity: "1:1 ratio replacement", notes: "Closest flavor match profile. Excellent in marinades or dressings." },
      { name: "White Wine Vinegar", quantity: "1/2 quantity of lemon juice", notes: "Good acidity substitute in savory cooking." },
      { name: "Apple Cider Vinegar", quantity: "1/2 quantity of lemon juice", notes: "Adds fruity acidity. Best in sauces and baking." }
    ]
  },
  {
    ingredient: "Soy Sauce",
    substitutes: [
      { name: "Tamari", quantity: "1:1 ratio replacement", notes: "Gluten-free alternative with a slightly richer, deeper flavor profile." },
      { name: "Coconut Aminos", quantity: "1:1 ratio replacement", notes: "Soy-free and gluten-free. Sweeter and lower in sodium than soy sauce." },
      { name: "Worcestershire Sauce", quantity: "1:1 ratio replacement", notes: "Good umami depth, but contains vinegar and anchovies. Best in savory beef dishes." }
    ]
  },
  {
    ingredient: "Yeast (Active Dry)",
    substitutes: [
      { name: "Baking Powder", quantity: "Replace with equal amount of baking powder", notes: "Dough does not require rising time. Bake immediately." },
      { name: "Baking Soda + Acid", quantity: "Equal parts baking soda + lemon juice/vinegar", notes: "Reacts immediately. Best for quick flatbreads." }
    ]
  },
  {
    ingredient: "Brown Sugar",
    substitutes: [
      { name: "White Sugar + Molasses", quantity: "1 cup sugar + 1 tbsp molasses", notes: "Mix well with a fork. Recreates brown sugar perfectly." },
      { name: "White Sugar + Maple Syrup", quantity: "1 cup sugar + 1 tbsp pure maple syrup", notes: "Adds similar moisture and caramel notes." },
      { name: "Coconut Sugar", quantity: "1:1 ratio replacement", notes: "Dry substitute. Slightly less sweet with a caramel taste." }
    ]
  },
  {
    ingredient: "Cornstarch (for thickening)",
    substitutes: [
      { name: "All-Purpose Flour", quantity: "2 tbsp flour per 1 tbsp cornstarch", notes: "Must be cooked slightly longer to remove raw flour taste." },
      { name: "Arrowroot Powder", quantity: "1:1 ratio replacement", notes: "Creates a beautiful glossy sheen. Excellent in acidic liquids; does not freeze well." },
      { name: "Tapioca Flour", quantity: "2 tbsp tapioca per 1 tbsp cornstarch", notes: "Yields a glossier finish. Perfect for pie fillings." }
    ]
  },
  {
    ingredient: "Garlic (1 clove)",
    substitutes: [
      { name: "Garlic Powder", quantity: "1/8 tsp garlic powder", notes: "Good dry substitute for seasonings/rubs." },
      { name: "Shallots", quantity: "1 tbsp minced shallot", notes: "Adds a mild, sweet onion-garlic flavor profile." },
      { name: "Chives", quantity: "1 tbsp chopped fresh chives", notes: "Best used as a fresh garnish replacement." }
    ]
  },
  {
    ingredient: "Ginger (1 tbsp fresh grated)",
    substitutes: [
      { name: "Ground Ginger", quantity: "1/4 tsp ground ginger powder", notes: "Much more concentrated flavor; lacks fresh zing. Adjust to taste." },
      { name: "Candied Ginger", quantity: "1 tbsp finely minced candied ginger", notes: "Rinse sugar coating off. Good in sweet baking." }
    ]
  }
];

// Open modal and optionally load search keyword
window.openSubstitutes = function(query = '') {
  const searchInput = document.getElementById('sub-search-input');
  if (searchInput) {
    searchInput.value = query;
  }
  
  filterSubstitutes(query);
  openModal('substitutes-modal');
};

// Filter substitution items in the modal list
window.filterSubstitutes = function(query = '') {
  const listContainer = document.getElementById('substitutes-list');
  if (!listContainer) return;
  
  const search = query.trim().toLowerCase();
  
  const filtered = substitutionData.filter(item => {
    // Match base ingredient name
    if (item.ingredient.toLowerCase().includes(search)) return true;
    
    // Match any substitute names
    return item.substitutes.some(sub => sub.name.toLowerCase().includes(search));
  });
  
  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; color: var(--color-text-tertiary); padding: 2rem 0;">
        No substitution entries found matching "${query}".
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = '';
  
  filtered.forEach(item => {
    const section = document.createElement('div');
    section.style.marginBottom = '1.5rem';
    section.style.borderBottom = '1px solid var(--color-border)';
    section.style.paddingBottom = '1rem';
    
    let subsHtml = '';
    item.substitutes.forEach(sub => {
      subsHtml += `
        <div style="background: var(--color-bg-tertiary); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-top: 0.5rem; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; color: var(--color-primary); margin-bottom: 0.15rem;">
            <span>${sub.name}</span>
            <span>${sub.quantity}</span>
          </div>
          <p style="color: var(--color-text-secondary); margin: 0; line-height: 1.4;">${sub.notes}</p>
        </div>
      `;
    });
    
    section.innerHTML = `
      <h4 style="font-weight: 800; font-size: 1rem; margin: 0; color: var(--color-text);">${item.ingredient}</h4>
      ${subsHtml}
    `;
    
    listContainer.appendChild(section);
  });
};

// Bind real-time search typing inside modal
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('sub-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterSubstitutes(e.target.value);
    });
  }
});
