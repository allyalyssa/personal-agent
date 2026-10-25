"""Build nutrition/recipes.json: the best-rated Food.com recipe for each popular dish, scaled to one serving.

Inputs (download from Kaggle, keep outside the repo):
  irkaal/foodcom-recipes-and-reviews   recipes.parquet  (ratings, nutrition, servings; CC0)
  saldenisov/recipenlg                 full_dataset.csv (full ingredient lines; CC BY-NC-SA 4.0)

  python scripts/build_recipes.py <recipes.parquet> <full_dataset.csv> [nutrition/recipes.json]
"""
import html
import json
import re
import sys
from fractions import Fraction

import pandas as pd

PRIOR_REVIEWS = 20
MIN_DISH_REVIEWS = 50

FILLER = re.compile(r"\b(easy|easiest|quick|simple|best|ever|the|my|our|ultimate|perfect|copycat|homemade|home made|authentic|delicious|yummy|super|really|famous|awesome|amazing|favorite|favourite|classic|traditional|recipe|world'?s|very|basic|old fashioned|fabulous|wonderful|incredible|terrific|tasty|great|good|\w+'s)\b")

DRINK = {'Beverages', 'Smoothies', 'Shakes', 'Punch Beverage', 'Hot Beverage'}
DESSERT = {'Dessert', 'Drop Cookies', 'Bar Cookie', 'Pie', 'Cheesecake', 'Frozen Desserts', 'Candy', 'Gelatin', 'Tarts', 'Cookie & Brownie', 'Ice Cream', 'Sweet'}
CONDIMENT = {'Sauces', 'Salad Dressings', 'Spreads', 'Canning', 'Jellies', 'Chutneys', 'Marinades', 'Homemade Spice Mixes'}
BREAKFAST = {'Breakfast', 'Breakfast Eggs', 'Breakfast Casseroles'}
SIDE = {'Vegetable', 'Potato', 'Rice', 'Corn', 'Grains', 'Breads', 'Yeast Breads', 'Quick Breads', 'Long Grain Rice', 'White Rice', 'Brown Rice', 'Yam/Sweet Potato', 'Greens', 'Onions', 'Cauliflower', 'Spinach', 'Beans', 'Black Beans', 'Lentil'}
SNACK = {'Lunch/Snacks', 'Nuts', 'Fruit', 'Apple', 'Berries', 'Tropical Fruits'}

CUISINE_TAGS = {
    'Thai': 'thai', 'Chinese': 'chinese', 'Japanese': 'japanese', 'Korean': 'korean', 'Vietnamese': 'vietnamese',
    'Indian': 'indian', 'Pakistani': 'indian', 'Mexican': 'mexican', 'Tex Mex': 'mexican', 'Southwestern U.S.': 'mexican',
    'Greek': 'greek', 'Southwest Asia (middle East)': 'middle_eastern', 'Lebanese': 'middle_eastern', 'Turkish': 'middle_eastern',
    'Moroccan': 'african', 'African': 'african', 'Ethiopian': 'african', 'Caribbean': 'caribbean', 'Cuban': 'caribbean',
    'Spanish': 'spanish', 'German': 'german', 'French': 'french', 'Cajun': 'cajun', 'Creole': 'cajun',
    'South American': 'latin_american', 'Brazilian': 'latin_american', 'Filipino': 'filipino', 'Hawaiian': 'hawaiian',
}
CUISINE_WORDS = [
    ('thai', r'pad thai|thai|satay|tom yum|larb'), ('japanese', r'teriyaki|sushi|miso|ramen|katsu|japanese|yakitori|udon'),
    ('korean', r'korean|bulgogi|kimchi|bibimbap'), ('vietnamese', r'pho\b|banh mi|vietnamese'),
    ('chinese', r'chinese|kung pao|lo mein|chow mein|fried rice|sweet and sour|general tso|szechuan|sesame chicken|egg roll|wonton|orange chicken|bourbon chicken|stir fry'),
    ('indian', r'curry|tikka|masala|tandoori|dal\b|dhal|korma|biryani|naan|samosa|indian|vindaloo|paneer'),
    ('mexican', r'taco|enchilada|burrito|quesadilla|fajita|salsa|guacamole|tamale|mexican|chile relleno|carnitas|pozole|chimichanga|nacho'),
    ('italian', r'lasagn|spaghetti|pasta|risotto|parmesan|parmigiana|alfredo|marinara|pizza|meatball|ziti|gnocchi|carbonara|italian|bruschetta|fettuccine|penne|minestrone|tortellini|ravioli|calzone|pesto|piccata|marsala|cacciatore'),
    ('greek', r'greek|gyro|souvlaki|tzatziki|spanakopita|moussaka'), ('middle_eastern', r'hummus|falafel|shawarma|tabbouleh|kebab|kabob|pita'),
    ('french', r'french|quiche|crepe|ratatouille|coq au vin|bourguignon'), ('cajun', r'cajun|jambalaya|gumbo|etouffee|creole'),
]
NOT_MAIN = re.compile(r'broth|stock|bouillon|soup|sauce|gravy|seasoning|bacon grease|drippings|fat\b|crumb|cracker')
MAIN_WORDS = [
    ('beef', r'beef|steak|sirloin|brisket|chuck|veal|hamburger|meatball|prime rib|rib ?eye|short ribs?|pot roast|tri.tip|meatloaf|sloppy joe'), ('pork', r'pork|bacon|ham\b|sausage|chorizo|prosciutto|pancetta|kielbasa|pepperoni'),
    ('lamb', r'lamb|mutton'), ('chicken', r'chicken|turkey|duck|poultry'),
    ('seafood', r'fish|salmon|tuna|cod\b|tilapia|halibut|shrimp|prawn|crab|lobster|\bscallops?\b|clam|mussel|sardine|anchov|catfish|trout|seafood'),
    ('legumes', r'tofu|tempeh|lentil|chickpea|garbanzo|\bbeans?\b|black beans|kidney beans|pinto|edamame|split peas'),
    ('eggs', r'\beggs?\b'), ('pasta', r'pasta|spaghetti|noodle|macaroni|penne|fettuccine|linguine|lasagna|rotini|ziti|tortellini|ravioli|orzo|gnocchi'),
    ('grains', r'\brice\b|quinoa|couscous|oats|bulgur|barley|polenta|grits|bread|tortilla'),
    ('potatoes', r'potato'), ('cheese', r'cheese'),
    ('vegetables', r'eggplant|aubergine|zucchini|broccoli|asparagus|spinach|cauliflower|squash|mushroom|carrot|cabbage|green bean|brussels|kale|salad|vegetable'),
    ('fruit', r'apple|banana|berr|peach|pear\b|mango|pineapple|orange|lemon|lime\b|cherr|grape|melon'),
]
MEATS = {'beef', 'pork', 'lamb', 'chicken', 'seafood'}
NOT_A_MEAL = re.compile(r'\b(batter|dough|crusts?|marinade|rub|seasoning|dressing|vinaigrette|sauce|gravy|frosting|icing|glaze|syrup|stock|broth|jam|jelly|butter|mayonnaise|aioli|salsa|dip|spread|croutons|mix|pickles?|brine)\s*$', re.I)
TOPPING_FOR = re.compile(r'\b(glaze|rub|marinade|sauce|seasoning|dressing|batter|brine) for\b', re.I)
JOINED = re.compile(r'\b(with|in|and|w)\b|&|/', re.I)
UNITS = {
    'cup': 'cup', 'cups': 'cup', 'c': 'cup', 'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tbsp': 'tbsp', 'tbs': 'tbsp', 'tb': 'tbsp',
    'teaspoon': 'tsp', 'teaspoons': 'tsp', 'tsp': 'tsp', 'lb': 'lb', 'lbs': 'lb', 'pound': 'lb', 'pounds': 'lb',
    'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz', 'g': 'g', 'gram': 'g', 'grams': 'g', 'kg': 'kg', 'ml': 'ml', 'l': 'l', 'liter': 'l', 'litre': 'l',
    'quart': 'quart', 'quarts': 'quart', 'qt': 'quart', 'pint': 'pint', 'pints': 'pint', 'clove': 'clove', 'cloves': 'clove',
    'can': 'can', 'cans': 'can', 'package': 'package', 'packages': 'package', 'pkg': 'package', 'jar': 'jar', 'jars': 'jar',
    'bottle': 'bottle', 'bottles': 'bottle', 'box': 'box', 'boxes': 'box', 'envelope': 'envelope', 'envelopes': 'envelope',
    'container': 'container', 'slice': 'slice', 'slices': 'slice', 'stick': 'stick', 'sticks': 'stick', 'bunch': 'bunch',
    'head': 'head', 'heads': 'head', 'pinch': 'pinch', 'dash': 'dash', 'sprig': 'sprig', 'sprigs': 'sprig', 'stalk': 'stalk', 'stalks': 'stalk',
}
UNICODE_FRACTIONS = {'½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⁄': '/'}
QTY = re.compile(r'^\s*(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?))?')


def dish_key(name):
    n = re.sub(r'\(.*?\)', ' ', html.unescape(str(name)).lower())
    n = re.sub(r'[^a-z\' ]', ' ', n)
    n = FILLER.sub(' ', n)
    return re.sub(r"\s+", ' ', n.replace("'", ' ')).strip()


def number(s):
    return float(sum(Fraction(p) for p in s.split()))


def parse_line(line, servings):
    text = line
    for k, v in UNICODE_FRACTIONS.items():
        text = text.replace(k, v)
    m = QTY.match(text)
    if not m:
        return {'line': line, 'qty': None, 'unit': None, 'item': text.strip()}
    qty = number(m.group(1)) if not m.group(2) else (number(m.group(1)) + number(m.group(2))) / 2
    rest = text[m.end():].strip()
    size = re.match(r'^\((.*?)\)\s*', rest)
    if size:
        rest = rest[size.end():]
    words = rest.split(' ', 1)
    unit = UNITS.get(words[0].lower().rstrip('.'))
    item = words[1] if unit and len(words) > 1 else rest
    out = {'line': line, 'qty': round(qty / servings, 3), 'unit': unit, 'item': item.strip()}
    if size:
        out['size'] = size.group(1)
    return out


def meal_type(category, keywords, name):
    core = re.sub(r'\b(copycat|clone|recipe|of)\b', '', re.sub(r'\(.*?\)', '', name)).strip(' !.-')
    if (NOT_A_MEAL.search(core) and not JOINED.search(core)) or TOPPING_FOR.search(name):
        return 'condiment'
    tags = {category, *keywords}
    if tags & DRINK:
        return 'drink'
    if tags & DESSERT:
        return 'dessert'
    if tags & CONDIMENT:
        return 'condiment'
    if category in BREAKFAST:
        return 'breakfast'
    if category in SIDE:
        return 'side'
    if category in SNACK:
        return 'snack'
    return 'main'


def cuisines(name, keywords):
    found = {CUISINE_TAGS[k] for k in keywords if k in CUISINE_TAGS}
    if not found:
        lower = name.lower()
        found = {c for c, rx in CUISINE_WORDS if re.search(rx, lower)}
    return sorted(found) or ['american']


def main_ingredient(name, ingredients):
    title = name.lower()
    meatless = re.search(r'vegetarian|vegan|meatless|veggie', title)
    named = next((main for main, rx in MAIN_WORDS if re.search(rx, title) and not (meatless and main in MEATS)), None)
    if named:
        return named
    items = [i['item'].lower() for i in ingredients
             if not NOT_MAIN.search(i['item'].lower()) and not (re.search(r'\beggs?\b|cheese', i['item'].lower()) and (i['qty'] or 0) < 0.5)]
    return next((main for main, rx in MAIN_WORDS if main not in ('fruit', 'vegetables') and any(re.search(rx, item) for item in items)), 'vegetables')


def minutes(iso):
    m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?', str(iso or ''))
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0) if m and (m.group(1) or m.group(2)) else None


def main(parquet, csv, out):
    rec = pd.read_parquet(parquet)
    rec = rec[rec.RecipeServings.between(1, 24) & rec.Calories.notna() & (rec.ReviewCount >= 1)].copy()
    rec['Keywords'] = rec.Keywords.map(lambda k: [] if k is None else [str(x) for x in k if x])
    mean = rec.AggregatedRating.mean()
    rec['score'] = (rec.ReviewCount * rec.AggregatedRating + PRIOR_REVIEWS * mean) / (rec.ReviewCount + PRIOR_REVIEWS)
    rec['dish'] = rec.Name.map(dish_key)
    rec['meal'] = [meal_type(c, k, html.unescape(n)) for c, k, n in zip(rec.RecipeCategory, rec.Keywords, rec.Name)]
    rec = rec[rec.meal.isin(['breakfast', 'main', 'side', 'snack']) & (rec.dish != '')]
    dish_reviews = rec.groupby('dish').ReviewCount.sum()
    rec = rec[rec.dish.map(dish_reviews) >= MIN_DISH_REVIEWS]

    lines = pd.read_csv(csv, usecols=['link', 'ingredients'])
    lines = lines[lines.link.str.contains('food.com/recipe', na=False)]
    lines['RecipeId'] = lines.link.str.extract(r'-(\d+)/?$')[0].astype(float)
    rec = rec.merge(lines[['RecipeId', 'ingredients']], on='RecipeId')
    best = rec.sort_values(['score', 'ReviewCount'], ascending=False).drop_duplicates('dish')

    recipes = []
    for r in best.itertuples():
        name = html.unescape(r.Name)
        ingredients = [parse_line(line, r.RecipeServings) for line in json.loads(r.ingredients)]
        recipes.append({
            'id': int(r.RecipeId),
            'name': name,
            'dish': r.dish,
            'url': f'https://www.food.com/recipe/{re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")}-{int(r.RecipeId)}',
            'meal': r.meal,
            'category': r.RecipeCategory,
            'cuisines': cuisines(name, r.Keywords),
            'main': main_ingredient(name, ingredients),
            'tags': [k for k in r.Keywords if k in ('Vegan', 'Lactose Free', 'Egg Free', 'Kosher', 'Very Low Carbs', 'High Protein', 'High Fiber', 'Low Cholesterol', 'Inexpensive')],
            'minutes': minutes(r.TotalTime),
            'servings': int(r.RecipeServings),
            'rating': float(r.AggregatedRating),
            'reviews': int(r.ReviewCount),
            'score': round(float(r.score), 3),
            'per_serving': {
                'kcal': round(r.Calories), 'protein_g': round(r.ProteinContent, 1), 'fat_g': round(r.FatContent, 1),
                'sat_fat_g': round(r.SaturatedFatContent, 1), 'carbs_g': round(r.CarbohydrateContent, 1), 'fiber_g': round(r.FiberContent, 1),
                'sugar_g': round(r.SugarContent, 1), 'sodium_mg': round(r.SodiumContent), 'cholesterol_mg': round(r.CholesterolContent),
            },
            'ingredients': ingredients,
        })
    recipes.sort(key=lambda x: x['dish'])
    with open(out, 'w', encoding='utf8') as f:
        json.dump({
            'source': 'Food.com via Kaggle irkaal/foodcom-recipes-and-reviews (CC0); ingredient lines from RecipeNLG (CC BY-NC-SA 4.0)',
            'source_url': 'https://www.kaggle.com/datasets/irkaal/foodcom-recipes-and-reviews',
            'license': 'CC BY-NC-SA 4.0',
            'ranking': f'Bayesian average: (reviews * rating + {PRIOR_REVIEWS} * {mean:.3f}) / (reviews + {PRIOR_REVIEWS}); one recipe per dish with {MIN_DISH_REVIEWS}+ reviews across the dish',
            'quantities': 'per one serving',
            'recipes': recipes,
        }, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(recipes)} recipes written to {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'nutrition/recipes.json')
