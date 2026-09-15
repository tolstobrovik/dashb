// What each page is for, and the handful of things people get wrong on it.
//
// Kept here rather than in the phrase book for the same reason the sprint
// guide is: this is a document, not a set of labels, and a phrase book keyed
// on English sentences would turn it into a hundred keys nobody could read as
// a whole.
//
// House rule for this text, the same one the sprint guide follows: no dashes
// anywhere, in any language. Short sentences, exact numbers, no encouragement.
// If a rule the board enforces is not written here, somebody will read it as a
// bug the first time it refuses them.
export const PAGE_GUIDES = {
  schedule: {
    en: [
      { h: 'What this page is', p: [
        'Every piece of work with a date on it, on one calendar.',
        'Releases shows the day a piece goes out. Recordings shows the day it is filmed.',
        'You see the whole team here, not only your own channels. Who is filming on Thursday is a question anybody can answer.',
      ] },
      { h: 'The colours', p: [
        'Every block wears the colour of the stage it is at. The stages and their colours are listed below.',
        'A block that is struck through was deleted. It stays on the record.',
      ] },
      { h: 'Moving a day', p: [
        'Drag a block to another day.',
        'A day that is already promised does not move for anybody but an admin. Ask, and say what happened.',
        'An idea is not a promise. Its days move freely, by anybody, until it leaves the idea stage.',
      ] },
      { h: 'A crowded day', p: [
        'Every cell is the same height. A day with more on it than fits scrolls inside its own cell.',
        'Click the empty part of a day to open that day whole, in order, with the times.',
      ] },
    ],
    ru: [
      { h: 'Что это за страница', p: [
        'Вся работа, у которой есть дата, в одном календаре.',
        'Releases показывает день выхода. Recordings показывает день съёмки.',
        'Здесь видно всю команду, а не только ваши каналы. Кто снимает в четверг, может ответить каждый.',
      ] },
      { h: 'Цвета', p: [
        'Каждый блок носит цвет своего этапа. Этапы и их цвета перечислены ниже.',
        'Зачёркнутый блок удалён. Он остаётся в истории.',
      ] },
      { h: 'Перенос дня', p: [
        'Перетащите блок на другой день.',
        'Обещанный день двигает только админ. Попросите и скажите, что случилось.',
        'Идея не обещание. Её дни двигает кто угодно, пока она остаётся идеей.',
      ] },
      { h: 'Плотный день', p: [
        'Все ячейки одной высоты. День, где не всё помещается, прокручивается внутри своей ячейки.',
        'Нажмите на пустую часть дня, чтобы открыть весь день по порядку, со временем.',
      ] },
    ],
    uz: [
      { h: 'Bu qanday sahifa', p: [
        'Sanasi bor barcha ish bitta kalendarda.',
        'Releases chiqish kunini, Recordings suratga olish kunini koʻrsatadi.',
        'Bu yerda butun jamoa koʻrinadi, faqat oʻz kanallaringiz emas. Payshanba kuni kim suratga oladi degan savolga har kim javob bera oladi.',
      ] },
      { h: 'Ranglar', p: [
        'Har bir blok oʻz bosqichining rangida. Bosqichlar va ularning ranglari quyida.',
        'Chizilgan blok oʻchirilgan. U tarixda qoladi.',
      ] },
      { h: 'Kunni koʻchirish', p: [
        'Blokni boshqa kunga torting.',
        'Vada qilingan kunni faqat admin koʻchiradi. Soʻrang va nima boʻlganini ayting.',
        'Gʻoya vada emas. U gʻoya boʻlib turganda kunlarini istalgan odam koʻchiradi.',
      ] },
      { h: 'Band kun', p: [
        'Har bir katak bir xil balandlikda. Sigʻmagan kun oʻz katagi ichida aylanadi.',
        'Kunning boʻsh joyiga bosing va butun kun tartib bilan, vaqtlari bilan ochiladi.',
      ] },
    ],
  },
  board: {
    en: [
      { h: 'What this page is', p: [
        'One channel, its whole pipeline, as columns.',
        'A card sits in the stage it has reached. Drag it to move it on.',
      ] },
      { h: 'What the board will refuse', p: [
        'Moving a piece into a stage that needs somebody will ask who. Name them and the move goes through.',
        'An idea moves freely. Anybody can push one along, and its days are not promises yet.',
        'Once a piece is being made, its days are settled until it is up for review.',
      ] },
      { h: 'The colours', p: [
        'The dot on each column is that stage colour. The same colour follows the piece onto every calendar.',
      ] },
    ],
    ru: [
      { h: 'Что это за страница', p: [
        'Один канал и весь его пайплайн в виде колонок.',
        'Карточка стоит в том этапе, до которого дошла. Перетащите её дальше.',
      ] },
      { h: 'Что доска не разрешит', p: [
        'Перенос в этап, которому нужен человек, спросит кто. Назовите его, и перенос пройдёт.',
        'Идея двигается свободно. Её толкает кто угодно, и её дни ещё не обещание.',
        'Когда работа делается, её дни закреплены до review.',
      ] },
      { h: 'Цвета', p: [
        'Точка на колонке это цвет этапа. Тот же цвет идёт за работой во все календари.',
      ] },
    ],
    uz: [
      { h: 'Bu qanday sahifa', p: [
        'Bitta kanal va uning butun quvuri ustunlar koʻrinishida.',
        'Karta oʻzi yetgan bosqichda turadi. Uni oldinga torting.',
      ] },
      { h: 'Doska nimani rad etadi', p: [
        'Odam talab qiladigan bosqichga koʻchirish kimligini soʻraydi. Nomini ayting va koʻchish oʻtadi.',
        'Gʻoya erkin harakatlanadi. Uni har kim surishi mumkin va kunlari hali vada emas.',
        'Ish qilinayotganda kunlari review gacha qotib turadi.',
      ] },
      { h: 'Ranglar', p: [
        'Ustundagi nuqta bosqich rangi. Xuddi shu rang ishni barcha kalendarlarga ergashadi.',
      ] },
    ],
  },
}
