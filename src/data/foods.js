// Starter food list: Jamaican staples plus a few basics.
//
// ESTIMATES ONLY. Home cooking varies a lot (oil, coconut milk, portion
// size), so treat these as starting points. Edit or save your own version
// from the app once you know your usual portions. Values are per serving.
//
// Fields: name, serving, calories, protein_g, carbs_g, fat_g, tags

const F = (name, serving, calories, protein_g, carbs_g, fat_g, tags = '') => ({
  id: `builtin:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  serving,
  calories,
  protein_g,
  carbs_g,
  fat_g,
  tags,
  builtin: true,
})

export const BUILTIN_FOODS = [
  // Breakfast & mains
  F('Ackee and saltfish', '1 cup (~200 g)', 380, 20, 10, 29, 'breakfast jamaican'),
  F('Callaloo, steamed', '1 cup (~150 g)', 60, 4, 8, 2, 'breakfast veg jamaican'),
  F('Callaloo and saltfish', '1 cup (~180 g)', 180, 16, 8, 9, 'breakfast jamaican'),
  F('Mackerel rundown', '1 cup (~220 g)', 450, 25, 10, 35, 'breakfast jamaican'),
  F('Jerk chicken, leg quarter', '1 piece (~150 g meat)', 400, 38, 3, 26, 'jamaican chicken'),
  F('Jerk chicken, breast quarter', '1 piece (~170 g meat)', 330, 50, 3, 13, 'jamaican chicken'),
  F('Jerk pork', '4 oz (~115 g)', 330, 30, 2, 22, 'jamaican pork'),
  F('Brown stew chicken', '1 cup with gravy (~240 g)', 420, 35, 8, 27, 'jamaican chicken'),
  F('Curry chicken', '1 cup (~240 g)', 380, 32, 8, 24, 'jamaican chicken'),
  F('Fried chicken', '2 pieces (~200 g)', 560, 40, 18, 36, 'chicken'),
  F('Curry goat', '1 cup (~240 g)', 400, 36, 8, 25, 'jamaican goat'),
  F('Oxtail and butter beans', '1 cup (~240 g)', 560, 38, 15, 38, 'jamaican beef'),
  F('Stew peas with meat', '1 cup (~250 g)', 420, 25, 35, 20, 'jamaican'),
  F('Escovitch fish', '1 small fish (~150 g edible)', 380, 35, 8, 23, 'jamaican fish'),
  F('Steamed fish with vegetables', '1 fish (~200 g)', 250, 38, 8, 7, 'jamaican fish'),
  F('Red peas soup', '1 bowl (~350 g)', 300, 18, 40, 8, 'jamaican soup'),
  F('Chicken foot / Saturday soup', '1 bowl (~350 g)', 250, 15, 30, 8, 'jamaican soup'),

  // Starches & sides ("food")
  F('Rice and peas', '1 cup (~200 g)', 380, 9, 55, 13, 'jamaican rice side'),
  F('White rice, cooked', '1 cup (~160 g)', 205, 4, 45, 0.4, 'rice side'),
  F('Fried dumpling', '1 medium (~70 g)', 230, 4, 30, 11, 'breakfast jamaican side'),
  F('Boiled dumpling', '1 medium (~80 g)', 180, 5, 37, 1, 'jamaican side'),
  F('Festival', '1 piece (~70 g)', 240, 4, 34, 10, 'jamaican side'),
  F('Bammy', '1 piece (~100 g)', 230, 1, 45, 5, 'jamaican side'),
  F('Boiled green banana', '1 medium (~120 g)', 110, 1.5, 28, 0.3, 'breakfast jamaican side'),
  F('Boiled yellow yam', '1 cup (~140 g)', 160, 2, 38, 0.2, 'jamaican side'),
  F('Roast breadfruit', '1 slice (~100 g)', 105, 1, 27, 0.2, 'jamaican side'),
  F('Fried ripe plantain', '½ plantain (~80 g)', 200, 1, 32, 8, 'breakfast jamaican side'),
  F('Boiled sweet potato', '1 medium (~150 g)', 130, 2.5, 30, 0.2, 'side'),
  F('Boiled dasheen', '1 cup (~130 g)', 185, 0.7, 45, 0.1, 'jamaican side'),
  F('Steamed cabbage', '1 cup (~150 g)', 50, 2, 8, 1.5, 'veg side'),
  F('Cho cho (chayote), boiled', '1 cup (~160 g)', 38, 1, 8, 0.8, 'veg side'),
  F('Roast corn', '1 ear', 150, 5, 32, 2, 'jamaican snack'),

  // Breads & bakery
  F('Jamaican beef patty', '1 patty (~130 g)', 470, 13, 40, 28, 'jamaican snack lunch'),
  F('Coco bread', '1 (~100 g)', 310, 7, 48, 10, 'jamaican bread'),
  F('Hard dough bread', '1 slice (~40 g)', 115, 3, 22, 1.5, 'jamaican bread breakfast'),
  F('Bulla cake', '1 (~85 g)', 300, 4, 62, 4, 'jamaican snack'),
  F('Gizzada', '1 (~60 g)', 250, 3, 30, 13, 'jamaican snack sweet'),
  F('Toto', '1 piece (~80 g)', 300, 3, 40, 14, 'jamaican snack sweet'),
  F('Water crackers', '4 crackers (~28 g)', 120, 3, 20, 3, 'snack'),
  F('Saltfish fritter (stamp and go)', '1 (~45 g)', 110, 4, 10, 6, 'jamaican snack'),
  F('Plantain or banana chips', '1 small bag (~28 g)', 150, 1, 16, 9, 'snack'),

  // Porridge & drinks
  F('Cornmeal porridge', '1 cup (~250 g)', 290, 6, 50, 7, 'breakfast jamaican porridge'),
  F('Peanut porridge', '1 cup (~250 g)', 420, 14, 45, 20, 'breakfast jamaican porridge'),
  F('Hominy porridge', '1 cup (~250 g)', 280, 6, 45, 8, 'breakfast jamaican porridge'),
  F('Sorrel drink', '1 cup (250 ml)', 130, 0, 33, 0, 'drink jamaican'),
  F('Carrot juice (with milk)', '1 cup (250 ml)', 230, 4, 38, 7, 'drink jamaican'),
  F('Soft drink, regular', '1 can (355 ml)', 150, 0, 39, 0, 'drink'),

  // Fruit
  F('Mango', '1 medium (~200 g flesh)', 120, 1.6, 30, 0.8, 'fruit'),
  F('Avocado (pear)', '½ medium (~100 g)', 160, 2, 9, 15, 'fruit'),
  F('Banana, ripe', '1 medium', 105, 1.3, 27, 0.4, 'fruit'),

  // Basics
  F('Egg, boiled', '1 large', 78, 6.3, 0.6, 5.3, 'breakfast protein'),
  F('Egg, fried', '1 large', 90, 6.3, 0.4, 7, 'breakfast protein'),
  F('Chicken breast, grilled', '100 g', 165, 31, 0, 3.6, 'protein'),
  F('Oats, cooked with water', '1 cup', 160, 6, 27, 3, 'breakfast'),
  F('Whole milk', '1 cup (250 ml)', 150, 8, 12, 8, 'drink breakfast'),
  F('Whey protein shake (water)', '1 scoop (~30 g)', 120, 24, 3, 1.5, 'protein drink'),
  F('Peanut butter', '1 tbsp (16 g)', 95, 4, 3, 8, 'snack'),
  F('Wholewheat bread', '1 slice', 80, 4, 14, 1, 'bread breakfast'),
]
