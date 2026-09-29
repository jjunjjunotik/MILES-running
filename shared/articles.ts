/**
 * 건강 정보 라이브러리에 들어가는 글.
 *
 * 쓰는 기준:
 * - 누구에게나 해가 없는 일반 정보만 담는다. 약·용량·시술·민간요법은 쓰지 않는다.
 * - "이러면 무슨 병입니다" 대신 "이런 모습은 이런 것들과 함께 이야기됩니다"로 쓴다.
 * - 치료 효과를 약속하지 않는다. "좋아집니다" 대신 "덜 눈에 띄는 경우가 많습니다".
 * - 모든 글은 화면에서 비진단 안내와 함께 보인다.
 */

export const ARTICLE_CATEGORIES = ["care", "observe", "changes", "consult"] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export const ARTICLE_CATEGORY_LABELS: Record<ArticleCategory, string> = {
  care: "Nail care",
  observe: "Basics",
  changes: "Common changes",
  consult: "When to get help",
};

export interface ArticleSeed {
  slug: string;
  category: ArticleCategory;
  title: string;
  summary: string;
  body: string;
  tags: string;
  sortOrder: number;
}

export const ARTICLE_DISCLAIMER =
  "This is general health information, not a diagnosis or treatment advice. If something keeps bothering you or doesn't go away, talk to a healthcare professional.";

export const ARTICLES: ArticleSeed[] = [
  {
    slug: "nail-basics",
    category: "observe",
    title: "How nails grow",
    summary: "About 3 mm a month. Knowing the pace helps you tell roughly when a change started.",
    tags: "growth rate,structure,basics",
    sortOrder: 10,
    body: `A nail is made by tissue under the base of the nail (the nail matrix) and pushed out toward the fingertip. Fingernails grow about 3 mm (roughly 1/8 inch) a month, and toenails grow more slowly than that.

That pace is useful because the position of a mark on the nail tells you roughly when it happened. A groove across the middle of a fingernail, for example, may point to something that affected nail growth two or three months ago.

A nail is a hard plate of dead cells. The part that has already grown out doesn't "heal"; it changes only as new nail grows in behind it. That's why you need to wait weeks or months before judging whether a change in your routine made a difference.

When you compare photos, use the same finger, similar light and a similar angle. Changing the light alone can make color and texture look quite different.`,
  },
  {
    slug: "photo-guide",
    category: "observe",
    title: "Taking a good nail photo",
    summary: "Bright daylight, the nail filling at least half the frame, and no polish.",
    tags: "photos,camera,comparing",
    sortOrder: 20,
    body: `**Find good light.** Daylight by a window works best. Under fluorescent light or in a dim room, colors come out different from real life. Face the light and keep your hand's shadow off the nail.

**Get close, but stay sharp.** Fill at least half the frame with the nail, at a distance where it stays in focus. Most phones lose focus closer than about 10 cm (4 inches).

**Remove polish and gel.** If the nail plate itself isn't visible, there's no way to see its color or surface.

**Repeat the same setup.** To see change over time, use the same finger, the same angle and similar brightness every time. A photo by the window and one taken at night will naturally look different.

**Photograph several nails.** Whether a change shows up on one nail or on several is an important difference. Keeping one photo of the whole hand makes later comparisons easier.`,
  },
  {
    slug: "daily-care",
    category: "care",
    title: "Habits that are easier on your nails",
    summary: "Nails take a long time to grow. Preventing damage is the faster route.",
    tags: "moisturizing,gloves,filing",
    sortOrder: 10,
    body: `**Water and detergent.** Long contact with water makes the nail plate swell and dry out over and over, and it starts to split more easily. Rubber gloves help for dishes, cleaning and other wet chores. A thin cotton pair underneath cuts down on sweat.

**Moisturize.** After washing your hands, rub cream into the skin around the nails too. It makes dry skin around the cuticle less noticeable. No special product is needed.

**Filing.** Sawing back and forth tends to make the tip peel in layers. File gently in one direction. Cutting too short or digging deep into the corners can lead to the nail growing into the skin.

**Cuticles.** The thin seal over the base of the nail keeps water and germs out. Pushing it back or pulling at it often leaves the area swollen.

**Don't use nails as tools.** Peeling off labels or opening cans with them causes cracks you can't see.

**Take breaks from nail products.** Wearing gel or acrylics for long stretches can leave the nail plate looking thinner. Giving your nails time off in between is a good idea.`,
  },
  {
    slug: "nutrition-basics",
    category: "care",
    title: "What's known about nails and diet",
    summary: "Claims that a certain supplement will fix your nails deserve some caution.",
    tags: "diet,nutrition,supplements",
    sortOrder: 20,
    body: `Nails are made mostly of a protein called keratin, so a generally balanced diet that includes protein is the starting point.

The internet is full of claims that a particular supplement will make nails stronger. Most have weak evidence behind them, or apply only to people with a specific deficiency. Whether you have a deficiency is checked with something like a blood test, not by looking at a photo or the shape of your nails.

**This app doesn't recommend supplements.** An app can't decide what kind or how much you should take, and some nutrients cause harm in large amounts. If you're worried about a deficiency, it's safer to get checked before buying anything on your own.

Drink enough water, get enough sleep and go easy on your hands. The advice anyone can give with confidence about nails is mostly this ordinary.`,
  },
  {
    slug: "vertical-ridges",
    category: "changes",
    title: "Vertical ridges",
    summary: "Shallow lines running from the base to the tip. They get more common with age.",
    tags: "vertical ridges,lines,dryness",
    sortOrder: 10,
    body: `Shallow lines running from the base of the nail toward the tip are known to become more common with age. When they're spread evenly across several nails and look about the same width, that's usually what's going on.

They can also stand out more in dry seasons or on hands that are often in water and detergent. Keeping your hands moisturized often makes them less noticeable, though ridges that are already there don't go away.

**When it may be something else.** If one line is much deeper or wider than the rest, if the nail starts splitting along it, or if it suddenly appeared on just one nail, that's a different situation from the one above. It's worth having someone take a look in person.

A photo can't measure how deep a ridge is, and the angle of the light can make ridges look sharper than they are.`,
  },
  {
    slug: "horizontal-grooves",
    category: "changes",
    title: "Grooves across the nail",
    summary: "Grooves at the same height across several nails are called Beau's lines.",
    tags: "Beau's lines,horizontal lines,grooves",
    sortOrder: 20,
    body: `A groove running across the nail is called a Beau's line. They typically show up at about the same height on several nails.

When the tissue that makes the nail pauses for a while, the nail formed during that time grows out slightly sunken. This is known to happen after things that affect the whole body, such as a high fever, an infection, major surgery or a procedure, or severe stress. Since nails grow about 3 mm a month, the groove's position gives a rough idea of how many months ago it happened.

If it's on only one nail, think back to whether that finger was injured or pinched.

**When it may be something else.** If the grooves keep getting deeper, or new ones keep appearing on several nails with no reason you can think of, it's worth getting them checked.`,
  },
  {
    slug: "color-bands",
    category: "changes",
    title: "Colored bands in the nail",
    summary: "Brown or black lines along the nail have many causes. Some need to be checked.",
    tags: "pigment,brown line,black line,melanonychia",
    sortOrder: 30,
    body: `A brown or black band running from the base of the nail to the tip is called longitudinal melanonychia. The name describes what it looks like, a colored band. It is not the name of a disease.

This appearance comes up alongside several different things: harmless pigment across several nails, which is common in darker skin; a mole (nevus) in the part that makes the nail; trapped blood after an injury; and color changes linked to some medicines. Rarely, nail melanoma can also look like this.

**You can't tell these apart by eye.** In the clinic, doctors look with a magnifying tool (dermoscopy) and, when needed, confirm with a biopsy. A photo can tell even less.

**Features known to call for a check:**
- The band is wide, 3 mm or more
- It's on only one nail (especially a thumb, index finger or big toe)
- The color inside the band is uneven, with dark and light lines mixed
- It's wider at the base than at the tip, like a triangle
- The color spreads past the nail onto the surrounding skin
- The edges are blurry or irregular
- It has recently gotten wider or darker
- The nail is splitting, lifting or bleeding at that spot

If any of these apply, see a dermatologist without putting it off. Most of the time it turns out not to be what people feared, but an exam is the only way to know. Bring older photos if you have them.`,
  },
  {
    slug: "brittle-nails",
    category: "changes",
    title: "Nails that split and break",
    summary: "Tips that peel in layers are common on hands that are often in water and detergent.",
    tags: "splitting,breaking,peeling",
    sortOrder: 40,
    body: `Nail tips that peel in thin layers or break easily are common. It tends to be more noticeable with frequent water and detergent, frequent filing, or a dry environment.

Wearing gloves, moisturizing and filing in one direction often make it less noticeable. The part that has already grown out won't change back, though, so it takes a few months to see a difference.

**When it may be something else.** A nail that thickens, changes color and crumbles comes up alongside things like a fungal nail infection (onychomycosis) or psoriasis-related nail changes. These often look alike, and in the clinic a fungal test tells them apart. Getting it checked is better than choosing a treatment on your own.`,
  },
  {
    slug: "around-the-nail",
    category: "changes",
    title: "The skin around the nail",
    summary: "Swollen, sore nail folds are common. Visible pus is a different story.",
    tags: "paronychia,cuticle,swelling",
    sortOrder: 50,
    body: `When the skin around the nail turns red, swells and hurts to press, it's called paronychia. It often follows pushing back or pulling at the cuticle, or long stretches of wet work.

When the same spot flares up again and again, it can become long-lasting, and the nail that grows out may look bumpy as a result.

**Signs that need a check:** pus or fluid, throbbing pain, redness spreading along the finger, or warmth in the area. When you notice these, don't squeeze or pick at it at home. See a healthcare professional.

If you have diabetes or are on treatment that weakens the immune system, it's safer to have even small infections looked at early.`,
  },
  {
    slug: "when-to-see-a-doctor",
    category: "consult",
    title: "When to think about seeing a doctor",
    summary: "Some things can't be told from a photo. An exam is the only way to check.",
    tags: "doctor,dermatologist,checkup",
    sortOrder: 10,
    body: `Below are situations in which getting checked is generally recommended. This list is not a diagnosis, and matching an item doesn't mean you have any particular condition.

**Better not to put off**
- A brown or black band on just one nail, especially if it's getting wider or the color is uneven
- Color that spreads past the nail onto the surrounding skin
- A nail lifting from the skin, or bleeding at that spot
- Swelling, pus or throbbing pain
- A nail coming off or changing shape quickly without an injury

**Worth watching, then getting checked**
- A change that has stayed the same for several weeks or more
- Changes that appeared on several nails at once
- A nail that is thickening, crumbling and changing color
- No change after months of adjusting your nail care

**Who to see.** Nails and the skin around them are looked at by dermatologists. It helps if you can say when the change started and how it has changed, and to bring older photos if you have them. Remove polish and trim your nails short beforehand so they're easier to examine.

**If you have diabetes or circulation problems, or are on treatment that weakens the immune system,** it's known to be safer to have even small changes in your hands and feet looked at early.`,
  },
  {
    slug: "what-photos-cannot-tell",
    category: "consult",
    title: "What a photo can't tell",
    summary: "A plain account of what this app can and can't do.",
    tags: "limits,not a diagnosis,AI",
    sortOrder: 20,
    body: `**What a photo can't tell you**
- Whether pigment is in the nail plate or in the skin underneath
- How deep a ridge or groove actually is
- Whether it hurts to press, or feels warm
- Whether the nail has really lifted (reflected light can make it look that way)
- When a change started (a single photo carries no sense of time)
- Anything checked with a blood test, such as nutritional status

**What happens in the clinic**
Doctors look with a magnifying tool (dermoscopy) and, when needed, run a fungal test or take a biopsy. These are ways to tell apart what eyes and photos can't.

**So this app**
describes what it can see, tells you what that kind of appearance tends to come up alongside, and says so when something looks like it needs a check. It never settles on one answer, never points you to medicines or procedures, and never reassures you that everything is fine. A result can't be a reason to stop worrying.`,
  },
];
