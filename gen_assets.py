import math, random, os
from PIL import Image, ImageDraw, ImageFilter

OUT_PUZZLES = "assets/puzzles"
OUT_ICONS = "assets/icons"
os.makedirs(OUT_PUZZLES, exist_ok=True)
os.makedirs(OUT_ICONS, exist_ok=True)

SIZE = 900

def lerp(a, b, t):
    return a + (b - a) * t

def vgrad(draw, w, h, top, bottom):
    for y in range(h):
        t = y / h
        r = int(lerp(top[0], bottom[0], t))
        g = int(lerp(top[1], bottom[1], t))
        b = int(lerp(top[2], bottom[2], t))
        draw.line([(0, y), (w, y)], fill=(r, g, b))

def radial_glow(img, cx, cy, radius, color, alpha=120):
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(*color, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(radius / 2))
    img.alpha_composite(glow)

def save(img, name):
    img.convert("RGB").save(os.path.join(OUT_PUZZLES, name), quality=90)
    print("saved", name)

random.seed(7)

# ---------- NATURE: mountains + sun ----------
def make_nature(seed, palette):
    random.seed(seed)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    vgrad(d, SIZE, SIZE, palette["sky_top"], palette["sky_bottom"])
    radial_glow(img, SIZE * 0.72, SIZE * 0.28, SIZE * 0.28, palette["sun"], 200)
    d = ImageDraw.Draw(img)
    d.ellipse([SIZE*0.62, SIZE*0.18, SIZE*0.82, SIZE*0.38], fill=(*palette["sun"], 255))
    layers = [(0.55, palette["hill_far"]), (0.68, palette["hill_mid"]), (0.82, palette["hill_near"])]
    for base_y, color in layers:
        pts = [(0, SIZE)]
        n = 7
        for i in range(n + 1):
            x = SIZE * i / n
            y = SIZE * base_y + math.sin(i * 1.7 + seed) * SIZE * 0.05 + random.uniform(-20, 20)
            pts.append((x, y))
        pts.append((SIZE, SIZE))
        d.polygon(pts, fill=(*color, 255))
    save(img, f"nature_{seed}.jpg")

make_nature(1, dict(sky_top=(30,58,95), sky_bottom=(140,168,190), sun=(255,214,150),
                     hill_far=(70,98,110), hill_mid=(46,72,84), hill_near=(24,44,52)))
make_nature(2, dict(sky_top=(18,40,36), sky_bottom=(120,168,140), sun=(255,236,170),
                     hill_far=(50,96,74), hill_mid=(32,70,54), hill_near=(16,42,32)))

# ---------- CITIES: skyline ----------
def make_city(seed, palette):
    random.seed(seed + 100)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    vgrad(d, SIZE, SIZE, palette["sky_top"], palette["sky_bottom"])
    radial_glow(img, SIZE * 0.5, SIZE * 0.85, SIZE * 0.5, palette["glow"], 90)
    d = ImageDraw.Draw(img)
    for layer, (alpha, ybase, wmin, wmax, hmin, hmax) in enumerate([
        (140, 0.62, 40, 90, 0.15, 0.45),
        (200, 0.72, 50, 110, 0.25, 0.6),
        (255, 0.85, 60, 130, 0.3, 0.75),
    ]):
        x = -20
        while x < SIZE + 20:
            w = random.uniform(wmin, wmax)
            h = SIZE * random.uniform(hmin, hmax)
            top = SIZE * ybase - h
            color = tuple(int(c * (alpha/255)) for c in palette["building"])
            d.rectangle([x, top, x + w, SIZE], fill=color)
            if random.random() > 0.4:
                for wy in range(int(top)+10, SIZE-10, 22):
                    for wx in range(int(x)+8, int(x+w)-8, 16):
                        if random.random() > 0.35:
                            d.rectangle([wx, wy, wx+6, wy+10], fill=(*palette["window"], 255))
            x += w + random.uniform(6, 18)
    save(img, f"cities_{seed}.jpg")

make_city(1, dict(sky_top=(20,24,48), sky_bottom=(90,70,120), glow=(255,150,120),
                   building=(30,32,50), window=(255,210,120)))
make_city(2, dict(sky_top=(12,18,30), sky_bottom=(40,60,90), glow=(120,180,255),
                   building=(22,26,40), window=(160,220,255)))

# ---------- ANIMALS: abstract fox-like silhouette ----------
def make_animal(seed, palette):
    random.seed(seed + 200)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    vgrad(d, SIZE, SIZE, palette["bg_top"], palette["bg_bottom"])
    cx, cy = SIZE*0.5, SIZE*0.58
    # body
    d.ellipse([cx-220, cy-140, cx+220, cy+220], fill=(*palette["fur"],255))
    # ears
    d.polygon([(cx-160, cy-120),(cx-60, cy-260),(cx-30, cy-90)], fill=(*palette["fur"],255))
    d.polygon([(cx+160, cy-120),(cx+60, cy-260),(cx+30, cy-90)], fill=(*palette["fur"],255))
    d.polygon([(cx-130, cy-135),(cx-70, cy-220),(cx-55, cy-110)], fill=(*palette["ear_in"],255))
    d.polygon([(cx+130, cy-135),(cx+70, cy-220),(cx+55, cy-110)], fill=(*palette["ear_in"],255))
    # face mask
    d.ellipse([cx-110, cy-60, cx+110, cy+140], fill=(*palette["mask"],255))
    # eyes
    d.ellipse([cx-70, cy-10, cx-30, cy+30], fill=(20,20,24,255))
    d.ellipse([cx+30, cy-10, cx+70, cy+30], fill=(20,20,24,255))
    # nose
    d.polygon([(cx-16, cy+55),(cx+16, cy+55),(cx, cy+80)], fill=(20,20,24,255))
    save(img, f"animals_{seed}.jpg")

make_animal(1, dict(bg_top=(60,40,30), bg_bottom=(200,140,80), fur=(214,110,50), ear_in=(255,230,220), mask=(250,238,225)))
make_animal(2, dict(bg_top=(20,30,40), bg_bottom=(70,90,110), fur=(90,90,100), ear_in=(230,230,235), mask=(240,240,245)))

# ---------- SPACE: planet + stars ----------
def make_space(seed, palette):
    random.seed(seed + 300)
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    vgrad(d, SIZE, SIZE, palette["bg_top"], palette["bg_bottom"])
    for _ in range(220):
        x, y = random.uniform(0, SIZE), random.uniform(0, SIZE)
        r = random.uniform(0.5, 2.2)
        b = random.randint(140, 255)
        d.ellipse([x-r, y-r, x+r, y+r], fill=(b, b, b, 255))
    radial_glow(img, SIZE*0.68, SIZE*0.35, SIZE*0.42, palette["planet"], 60)
    d = ImageDraw.Draw(img)
    d.ellipse([SIZE*0.42, SIZE*0.10, SIZE*0.92, SIZE*0.60], fill=(*palette["planet"],255))
    band = Image.new("RGBA", (SIZE, SIZE), (0,0,0,0))
    bd = ImageDraw.Draw(band)
    for i in range(6):
        yy = SIZE*0.15 + i*SIZE*0.06
        bd.ellipse([SIZE*0.42, yy, SIZE*0.92, yy+SIZE*0.10], fill=(*palette["band"], 60))
    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([SIZE*0.42, SIZE*0.10, SIZE*0.92, SIZE*0.60], fill=255)
    img.paste(Image.alpha_composite(img, band), (0,0), mask)
    save(img, f"space_{seed}.jpg")

make_space(1, dict(bg_top=(6,8,20), bg_bottom=(20,14,40), planet=(200,120,90), band=(255,220,180)))
make_space(2, dict(bg_top=(4,6,16), bg_bottom=(10,20,36), planet=(90,140,200), band=(200,230,255)))

# ---------- ABSTRACTION: geometric shapes ----------
def make_abstract(seed, palette):
    random.seed(seed + 400)
    img = Image.new("RGBA", (SIZE, SIZE), (*palette["bg"], 255))
    d = ImageDraw.Draw(img)
    for i in range(9):
        shape = random.choice(["circle", "rect", "tri"])
        color = random.choice(palette["colors"])
        alpha = random.randint(140, 230)
        cx, cy = random.uniform(0, SIZE), random.uniform(0, SIZE)
        s = random.uniform(SIZE*0.12, SIZE*0.38)
        layer = Image.new("RGBA", (SIZE, SIZE), (0,0,0,0))
        ld = ImageDraw.Draw(layer)
        if shape == "circle":
            ld.ellipse([cx-s, cy-s, cx+s, cy+s], fill=(*color, alpha))
        elif shape == "rect":
            ang = random.uniform(0, 45)
            ld.rectangle([cx-s, cy-s*0.6, cx+s, cy+s*0.6], fill=(*color, alpha))
            layer = layer.rotate(ang, center=(cx, cy))
        else:
            ld.polygon([(cx, cy-s), (cx-s, cy+s), (cx+s, cy+s)], fill=(*color, alpha))
        img.alpha_composite(layer)
    save(img, f"abstraction_{seed}.jpg")

make_abstract(1, dict(bg=(18,16,26), colors=[(240,120,90),(90,180,200),(250,200,90),(150,110,220)]))
make_abstract(2, dict(bg=(250,247,240), colors=[(30,30,40),(220,90,70),(60,140,160),(240,180,60)]))

print("Gallery images generated.")

# ---------- App icon: puzzle piece mark ----------
def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    d = ImageDraw.Draw(img)
    bg_pad = int(size*0.08) if maskable else 0
    d.rounded_rectangle([0,0,size,size], radius=int(size*(0.28 if not maskable else 0.0)),
                         fill=(18, 19, 26, 255))
    # puzzle piece shape (single tab piece) centered
    cx, cy = size/2, size/2
    s = size * (0.30 if not maskable else 0.24)
    tab = s * 0.42
    pts = []
    # simple rounded puzzle piece silhouette using an ellipse union approximated with polygon+circles
    piece = Image.new("RGBA", (size, size), (0,0,0,0))
    pd = ImageDraw.Draw(piece)
    pd.rounded_rectangle([cx-s, cy-s, cx+s, cy+s], radius=s*0.22, fill=(242, 169, 59, 255))
    pd.ellipse([cx+s-tab*0.6, cy-tab, cx+s+tab*0.9, cy+tab], fill=(242, 169, 59, 255))
    pd.ellipse([cx-tab*0.5, cy-s-tab*0.9, cx+tab*0.5, cy-s+tab*0.5], fill=(18,19,26,255))
    img.alpha_composite(piece)
    img.save(os.path.join(OUT_ICONS, f"icon-{size}{'-maskable' if maskable else ''}.png"))
    print("icon", size, maskable)

for sz in [72, 96, 128, 144, 152, 192, 384, 512]:
    make_icon(sz, maskable=False)
make_icon(512, maskable=True)
make_icon(192, maskable=True)

print("Icons generated.")
