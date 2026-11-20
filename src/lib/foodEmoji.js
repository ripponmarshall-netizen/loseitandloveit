// A picture for a logged food, from words in its name. First match wins, so
// specific dishes come before the ingredients they contain.
// Pure: tested in tests/food.test.js.

const RULES = [
  [/\bwater\b/, '💧'],
  [/\b(coffee|latte|cappuccino|espresso)\b/, '☕'],
  [/\b(tea|bush tea|mint tea)\b/, '🍵'],
  [/\b(protein shake|smoothie|shake)\b/, '🥤'],
  [/\b(soda|cola|coke|ting|kola champagne|pepsi|sprite)\b/, '🥤'],
  [/\b(juice|sorrel|carrot juice|lemonade)\b/, '🧃'],
  [/\b(beer|red stripe|guinness|stout)\b/, '🍺'],
  [/\b(rum|whisky|whiskey|vodka|wine|liquor)\b/, '🥃'],
  [/\b(milk|yogurt|yoghurt)\b/, '🥛'],
  [/\b(porridge|cornmeal porridge|oats|oatmeal|cereal|granola)\b/, '🥣'],
  [/\bpatty\b|\bpatties\b/, '🥟'],
  [/\b(dumpling|dumplings)\b/, '🥟'],
  [/\b(saltfish|fish|snapper|escovitch|mackerel|sardine|tuna|salmon|sprat)\b/, '🐟'],
  [/\b(shrimp|prawn|lobster|crab)\b/, '🍤'],
  [/\b(curry|stew peas|oxtail|curry goat|mannish water)\b/, '🍛'],
  [/\b(soup|pepperpot|pepper pot|red peas soup|broth)\b/, '🍲'],
  [/\b(chicken|jerk|wings|drumstick)\b/, '🍗'],
  [/\b(beef|steak|goat|mutton|lamb|corned beef)\b/, '🥩'],
  [/\b(pork|bacon|ham|sausage|hot dog)\b/, '🥓'],
  [/\b(egg|eggs|omelette|omelet)\b/, '🥚'],
  [/\b(burger|hamburger)\b/, '🍔'],
  [/\b(pizza)\b/, '🍕'],
  [/\b(fries|chips)\b/, '🍟'],
  [/\b(sandwich|sub|wrap|hard dough)\b/, '🥪'],
  [/\b(pasta|spaghetti|macaroni|noodles|lasagna|lasagne)\b/, '🍝'],
  [/\b(rice|rice and peas|fried rice)\b/, '🍚'],
  [/\b(bammy|roti|festival|johnny ?cake|fried dumpling|bread|toast|bun|bagel|crackers)\b/, '🍞'],
  [/\b(plantain|banana|green banana)\b/, '🍌'],
  [/\b(yam|sweet potato|potato|dasheen|breadfruit|cassava)\b/, '🍠'],
  [/\b(callaloo|cabbage|salad|lettuce|spinach|pak choi|veg|vegetables|broccoli)\b/, '🥗'],
  [/\b(ackee)\b/, '🍳'],
  [/\b(avocado|pear)\b/, '🥑'],
  [/\b(mango)\b/, '🥭'],
  [/\b(orange|tangerine|ortanique)\b/, '🍊'],
  [/\b(apple)\b/, '🍎'],
  [/\b(pineapple)\b/, '🍍'],
  [/\b(watermelon|melon)\b/, '🍉'],
  [/\b(coconut|jelly coconut)\b/, '🥥'],
  [/\b(corn|roast corn)\b/, '🌽'],
  [/\b(peanut|nuts|almond|cashew)\b/, '🥜'],
  [/\b(cheese)\b/, '🧀'],
  [/\b(ice cream)\b/, '🍨'],
  [/\b(cake|gizzada|grater cake|toto|pudding)\b/, '🍰'],
  [/\b(cookie|biscuit)\b/, '🍪'],
  [/\b(chocolate)\b/, '🍫'],
  [/\b(fruit)\b/, '🍓'],
]

const BY_MEAL = { breakfast: '🌅', lunch: '🍽️', dinner: '🍽️', snack: '🍿' }

export function foodEmoji(name, meal) {
  const n = String(name || '').toLowerCase()
  for (const [re, e] of RULES) if (re.test(n)) return e
  return BY_MEAL[meal] || '🍽️'
}
