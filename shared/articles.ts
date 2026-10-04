/**
 * 건강 정보 라이브러리에 들어가는 글.
 *
 * 쓰는 기준:
 * - 누구에게나 해가 없는 일반 정보만 담는다. 약·용량·시술·민간요법은 쓰지 않는다.
 * - "이러면 무슨 병입니다" 대신 "이런 모습은 이런 것들과 함께 이야기됩니다"로 쓴다.
 * - 치료 효과를 약속하지 않는다. "좋아집니다" 대신 "덜 눈에 띄는 경우가 많습니다".
 * - 모든 글은 화면에서 비진단 안내와 함께 보인다.
 */

import type { Locale } from "./i18n.js";

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

/* --------------------------------- 한국어 --------------------------------- */

export const ARTICLE_CATEGORY_LABELS_KO: Record<ArticleCategory, string> = {
  care: "손톱 관리",
  observe: "관찰하는 법",
  changes: "흔한 변화",
  consult: "상담이 필요할 때",
};

export const ARTICLE_DISCLAIMER_KO =
  "이 글은 일반적인 건강 정보이며 진단이나 치료 안내가 아닙니다. 증상이 이어지거나 걱정된다면 의료 전문가와 상담하세요.";

export const ARTICLES_KO: ArticleSeed[] = [
  {
    slug: "nail-basics",
    category: "observe",
    title: "손톱은 어떻게 자라나요",
    summary: "한 달에 약 3mm. 이 속도를 알면 변화가 언제 생긴 일인지 가늠할 수 있습니다.",
    tags: "성장 속도,구조,기본",
    sortOrder: 10,
    body: `손톱은 손톱 뿌리 아래에 있는 조직(조갑기질)에서 만들어져 손끝 쪽으로 밀려 나옵니다. 손톱은 한 달에 약 3mm, 발톱은 그보다 느리게 자라는 것으로 알려져 있습니다.

이 속도가 왜 쓸모 있냐면, 손톱에 남은 자국의 위치로 그 일이 대략 언제 있었는지 가늠할 수 있기 때문입니다. 예를 들어 손톱 중간쯤에 가로로 홈이 있다면 두어 달 전쯤 손톱이 자라는 데 영향을 준 일이 있었을 수 있습니다.

손톱은 죽은 세포가 단단하게 굳은 판입니다. 그래서 이미 자라 나온 부분은 "회복"되지 않고, 새로 자라는 부분이 밀어내며 바뀝니다. 관리의 효과를 확인하려면 최소 몇 주에서 몇 달은 보아야 하는 이유입니다.

사진으로 비교할 때는 같은 손가락, 비슷한 조명, 비슷한 각도로 찍어야 의미가 있습니다. 조명만 바꿔도 색과 결이 꽤 달라 보입니다.`,
  },
  {
    slug: "photo-guide",
    category: "observe",
    title: "손톱 사진을 잘 찍는 법",
    summary: "밝은 자연광, 손톱이 화면의 절반 이상, 매니큐어는 지우고.",
    tags: "촬영,사진,비교",
    sortOrder: 20,
    body: `**밝은 곳에서.** 창가의 자연광이 가장 좋습니다. 형광등 아래나 어두운 방에서는 색이 실제와 다르게 찍힙니다. 정면에서 빛이 오게 하고, 손 그림자가 손톱을 덮지 않게 하세요.

**가까이, 그러나 초점이 맞게.** 손톱이 화면의 절반 이상을 채우되 흐려지지 않는 거리를 찾으세요. 대부분의 휴대폰은 10cm 안쪽에서 초점을 놓칩니다.

**매니큐어와 젤은 지우고.** 손톱판 자체가 보이지 않으면 색도 표면도 관찰할 수 없습니다.

**같은 조건으로 반복.** 변화를 보려면 매번 같은 손가락, 같은 각도, 비슷한 밝기로 찍는 것이 중요합니다. 한 번은 창가, 한 번은 밤에 찍으면 달라 보이는 것이 당연합니다.

**여러 손톱을 함께.** 한 손톱에만 있는 변화인지, 여러 손톱에 같이 있는 변화인지는 중요한 차이입니다. 손 전체를 찍은 사진도 한 장 남겨 두면 나중에 비교하기 좋습니다.`,
  },
  {
    slug: "daily-care",
    category: "care",
    title: "손톱을 덜 상하게 하는 습관",
    summary: "손톱은 자라는 데 시간이 걸립니다. 덜 상하게 하는 쪽이 빠릅니다.",
    tags: "보습,장갑,다듬기",
    sortOrder: 10,
    body: `**물과 세제.** 오래 물에 닿으면 손톱판이 부풀었다 마르기를 반복하면서 잘 갈라집니다. 설거지나 청소처럼 물과 세제에 오래 닿는 일에는 고무장갑을 쓰는 편이 좋습니다. 면장갑을 안에 끼면 땀이 차는 것을 줄일 수 있습니다.

**보습.** 손을 씻은 뒤 손톱 주변까지 크림을 발라 주면 큐티클 주변 각질이 덜 눈에 띕니다. 특별한 제품이 필요하지는 않습니다.

**다듬기.** 줄로 앞뒤로 문지르면 손톱 끝이 층층이 일어나기 쉽습니다. 한 방향으로 부드럽게 다듬으세요. 너무 짧게 깎거나 모서리를 깊게 파면 살로 파고들 수 있습니다.

**큐티클.** 손톱 아래쪽을 덮은 얇은 막은 세균과 물이 들어가지 못하게 막아 주는 자리입니다. 밀거나 뜯으면 그 자리가 자주 붓습니다.

**손톱을 도구로 쓰지 않기.** 스티커를 떼거나 캔을 여는 데 쓰면 보이지 않는 금이 갑니다.

**네일 제품을 쉬어 주기.** 젤이나 아크릴을 오래 이어서 하면 손톱판이 얇아져 보이는 경우가 있습니다. 중간중간 쉬는 기간을 두는 편이 좋습니다.`,
  },
  {
    slug: "nutrition-basics",
    category: "care",
    title: "손톱과 식사에 대해 알려진 것",
    summary: "특정 영양제가 손톱을 좋게 만든다는 말은 조심해서 들어야 합니다.",
    tags: "식사,영양,보충제",
    sortOrder: 20,
    body: `손톱은 주로 케라틴이라는 단백질로 되어 있습니다. 그래서 전반적으로 균형 잡힌 식사, 특히 단백질을 포함한 식사가 기본입니다.

인터넷에는 "이 영양제를 먹으면 손톱이 단단해진다"는 이야기가 많지만, 대부분은 근거가 약하거나 특정 결핍이 있는 사람에게만 해당하는 이야기입니다. 결핍이 있는지는 사진이나 손톱 모양이 아니라 혈액 검사 같은 방법으로 확인합니다.

**이 앱은 영양제를 권하지 않습니다.** 용량과 종류를 앱이 정해 줄 수 없고, 어떤 성분은 많이 먹으면 오히려 해롭습니다. 결핍이 걱정된다면 임의로 사 먹기 전에 진료를 받고 확인하는 편이 안전합니다.

물을 충분히 마시고, 잠을 충분히 자고, 손을 험하게 쓰지 않는 것. 손톱에 대해 확실하게 말할 수 있는 조언은 대체로 이렇게 평범합니다.`,
  },
  {
    slug: "vertical-ridges",
    category: "changes",
    title: "세로 줄무늬",
    summary: "손톱 뿌리에서 끝으로 이어지는 얕은 결. 나이가 들면서 흔해집니다.",
    tags: "세로줄,능선,건조",
    sortOrder: 10,
    body: `손톱 뿌리에서 끝 방향으로 이어지는 얕은 세로 결은 나이가 들면서 흔하게 늘어나는 변화로 알려져 있습니다. 여러 손톱에 고르게 있고 굵기가 비슷하다면 대개 그런 경우입니다.

건조한 계절이나 물·세제에 자주 닿는 손에서 더 도드라져 보이기도 합니다. 보습을 챙기면 덜 눈에 띄는 경우가 많지만, 이미 생긴 결 자체가 사라지는 것은 아닙니다.

**다르게 볼 때.** 한 줄만 유독 깊고 넓어지거나, 그 줄을 따라 손톱이 갈라지기 시작하거나, 한 손톱에만 갑자기 생겼다면 그건 위의 이야기와 다른 경우일 수 있습니다. 그럴 때는 직접 보여 주는 편이 좋습니다.

사진으로는 결의 깊이를 잴 수 없습니다. 조명 각도에 따라 실제보다 뚜렷해 보이기도 합니다.`,
  },
  {
    slug: "horizontal-grooves",
    category: "changes",
    title: "가로 방향 홈",
    summary: "여러 손톱에 같은 높이로 패인 가로 홈을 보우선이라고 부릅니다.",
    tags: "보우선,가로줄,홈",
    sortOrder: 20,
    body: `손톱을 가로질러 패인 홈을 보우선(Beau's line)이라고 부릅니다. 여러 손톱에 비슷한 높이로 함께 나타나는 것이 특징입니다.

손톱을 만드는 조직이 잠시 일을 멈추면 그 시기에 만들어진 부분이 얕게 패여 나옵니다. 고열, 감염, 큰 수술이나 시술, 심한 스트레스처럼 몸 전체에 영향을 준 일 뒤에 나타나는 것으로 알려져 있습니다. 손톱이 한 달에 약 3mm 자라는 것을 감안하면 홈의 위치로 대략 몇 달 전 일인지 가늠해 볼 수 있습니다.

한 손톱에만 있다면 그 손가락을 다쳤거나 눌린 적이 있는지 떠올려 보세요.

**다르게 볼 때.** 홈이 점점 깊어지거나, 이유를 떠올릴 수 없는데 여러 손톱에 계속 새로 생긴다면 확인해 보는 편이 좋습니다.`,
  },
  {
    slug: "color-bands",
    category: "changes",
    title: "손톱의 색 띠",
    summary: "갈색이나 검은 세로 띠는 여러 원인으로 생깁니다. 확인이 필요한 경우가 있습니다.",
    tags: "색소,갈색,검은줄,흑색선조",
    sortOrder: 30,
    body: `손톱에 뿌리에서 끝으로 이어지는 갈색이나 검은 띠가 보이는 것을 조갑 흑색선조(melanonychia striata)라고 부릅니다. 이 이름은 "색 띠가 있다"는 모습을 가리키는 말이지 병명이 아닙니다.

이런 모습은 여러 가지와 함께 이야기됩니다. 색소가 많은 피부에서 여러 손톱에 생기는 양성 색소 침착, 손톱을 만드는 부분에 생긴 점(모반), 부딪힌 뒤 고인 피, 일부 약과 관련된 색 변화 등입니다. 드물게는 손발톱 흑색종도 이런 모습으로 나타날 수 있습니다.

**눈으로는 이 중 어느 것인지 가릴 수 없습니다.** 진료실에서는 확대경(더모스코피)으로 보고, 필요하면 조직검사로 확인합니다. 사진은 더더욱 가릴 수 없습니다.

**특히 확인이 필요한 모습으로 알려진 것들:**
- 폭이 3mm 이상으로 넓다
- 한 손톱에만 있다 (특히 엄지, 검지, 엄지발가락)
- 띠 안에서 색이 고르지 않고 진한 선과 옅은 선이 섞여 있다
- 뿌리 쪽이 끝보다 넓어 삼각형처럼 보인다
- 색이 손톱을 넘어 주변 피부까지 이어진다
- 경계가 흐리거나 불규칙하다
- 최근에 넓어지거나 짙어졌다
- 그 자리에서 손톱이 갈라지거나 들뜨거나 피가 비친다

하나라도 해당하면 미루지 말고 피부과 진료를 받아 보세요. 대부분은 걱정하던 것이 아니지만, 확인하는 방법이 진료밖에 없습니다. 예전에 찍은 사진이 있다면 함께 가져가면 도움이 됩니다.`,
  },
  {
    slug: "brittle-nails",
    category: "changes",
    title: "잘 갈라지고 부서지는 손톱",
    summary: "손톱 끝이 층층이 일어나는 것은 물과 세제에 자주 닿는 손에서 흔합니다.",
    tags: "갈라짐,부서짐,층",
    sortOrder: 40,
    body: `손톱 끝이 얇게 층층이 일어나거나 잘 부서지는 모습은 흔합니다. 물과 세제에 자주 닿거나, 손톱을 자주 다듬거나, 건조한 환경에 있을 때 더 두드러지는 것으로 알려져 있습니다.

장갑을 쓰고, 보습을 챙기고, 다듬기를 한 방향으로 하는 것만으로도 덜 눈에 띄는 경우가 많습니다. 다만 이미 자라 나온 부분이 되돌아가지는 않으므로, 달라지는지 보려면 몇 달은 필요합니다.

**다르게 볼 때.** 손톱이 두꺼워지면서 색이 변하고 부스러진다면 조갑진균증이나 건선성 손발톱 변화 같은 것들과 함께 이야기됩니다. 이 셋은 눈으로 자주 겹쳐 보이고, 진료실에서는 진균 검사로 가립니다. 혼자 판단해서 약을 쓰기보다 확인을 받는 편이 좋습니다.`,
  },
  {
    slug: "around-the-nail",
    category: "changes",
    title: "손톱 주변 피부",
    summary: "손톱 옆선이 붓고 아픈 것은 흔하지만, 진물이 보이면 다릅니다.",
    tags: "주위염,큐티클,붓기",
    sortOrder: 50,
    body: `손톱을 감싼 피부가 붉어지고 붓고 누르면 아픈 것을 손톱 주위염이라고 부릅니다. 큐티클을 밀거나 뜯은 뒤, 물에 오래 닿는 일을 한 뒤에 흔하게 생깁니다.

같은 자리가 반복해서 덧나면 만성으로 이어지기도 하고, 그 영향으로 자라 나오는 손톱 모양이 울퉁불퉁해 보이기도 합니다.

**확인이 필요한 모습:** 진물이나 고름이 보일 때, 욱신거리는 통증이 있을 때, 붉은 기가 손가락 쪽으로 번질 때, 열감이 함께 있을 때입니다. 이럴 때는 집에서 짜거나 건드리지 말고 진료를 받아 보세요.

당뇨가 있거나 면역이 약해지는 치료를 받는 중이라면 작은 염증도 일찍 보여 주는 편이 안전합니다.`,
  },
  {
    slug: "when-to-see-a-doctor",
    category: "consult",
    title: "이럴 때는 진료를 생각해 보세요",
    summary: "사진으로 가릴 수 없는 것들이 있습니다. 확인하는 방법은 진료뿐입니다.",
    tags: "상담,피부과,진료",
    sortOrder: 10,
    body: `아래는 일반적으로 확인을 권하는 상황들입니다. 이 목록은 진단이 아니며, 해당한다고 해서 특정 질환이 있다는 뜻도 아닙니다.

**미루지 않는 편이 좋은 경우**
- 한 손톱에만 생긴 갈색·검은 띠, 특히 넓어지거나 색이 고르지 않을 때
- 색이 손톱을 넘어 주변 피부까지 이어질 때
- 손톱이 살에서 들뜨거나, 그 자리에서 피가 비칠 때
- 붓기·진물·욱신거리는 통증이 함께 있을 때
- 다치지 않았는데 손톱이 빠지거나 모양이 빠르게 달라질 때

**시간을 두고 보되 확인해 볼 만한 경우**
- 몇 주 이상 그대로인 변화
- 여러 손톱에 동시에 생긴 변화
- 손톱이 두꺼워지고 부스러지며 색이 변할 때
- 관리 방법을 바꿔도 몇 달째 같을 때

**어디로 가면 되나요.** 손톱과 손톱 주변 피부는 피부과에서 봅니다. 진료 때 "언제부터, 어떻게 달라졌는지"를 말할 수 있으면 도움이 되고, 예전 사진이 있으면 가져가세요. 매니큐어는 지우고, 손톱은 짧게 정리해 두면 보기 좋습니다.

**당뇨, 순환 장애, 면역이 약해지는 치료를 받는 중이라면** 손·발의 작은 변화도 일찍 보여 주는 편이 안전한 것으로 알려져 있습니다.`,
  },
  {
    slug: "what-photos-cannot-tell",
    category: "consult",
    title: "사진으로 알 수 없는 것",
    summary: "이 앱이 할 수 있는 일과 할 수 없는 일을 정확히 적어 둡니다.",
    tags: "한계,비진단,AI",
    sortOrder: 20,
    body: `**사진으로 알 수 없는 것들**
- 색소가 손톱판 안에 있는지 그 아래 피부에 있는지
- 결이나 홈의 실제 깊이
- 눌렀을 때 아픈지, 열감이 있는지
- 손톱이 실제로 들떠 있는지 (빛 반사로 그렇게 보이기도 합니다)
- 변화가 언제부터인지 (사진 한 장에는 시간이 담기지 않습니다)
- 혈액 검사로 확인하는 것들, 예를 들어 영양 상태

**진료실에서 하는 일**
확대경(더모스코피)으로 보고, 필요하면 진균 검사나 조직검사를 합니다. 눈과 사진으로 가릴 수 없는 것을 가리는 방법입니다.

**그래서 이 앱은**
보이는 것을 정리하고, 그런 모습이 무엇들과 함께 이야기되는지 알려 주고, 확인이 필요해 보이면 그렇게 말합니다. 어느 하나로 확정하지 않고, 약이나 시술을 안내하지 않으며, "괜찮습니다"라고 안심시키지도 않습니다. 결과가 안심의 근거가 될 수 없다는 뜻입니다.`,
  },
];

/** 언어별 글 묶음. 슬러그는 두 언어가 같다. */
export function articleSet(locale: Locale) {
  return locale === "ko"
    ? {
        articles: ARTICLES_KO,
        categoryLabels: ARTICLE_CATEGORY_LABELS_KO,
        disclaimer: ARTICLE_DISCLAIMER_KO,
      }
    : {
        articles: ARTICLES,
        categoryLabels: ARTICLE_CATEGORY_LABELS,
        disclaimer: ARTICLE_DISCLAIMER,
      };
}
