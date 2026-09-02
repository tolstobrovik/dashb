// How sprints work, in the three languages the board speaks.
//
// Kept here rather than in the phrase book because it is a document, not a
// set of labels: the phrase book is keyed on English sentences and would turn
// forty paragraphs into forty keys nobody could edit as a whole. One file,
// three columns, edited side by side.
//
// House rule for this text: no dashes anywhere, in any language. Short
// sentences, exact numbers, no encouragement.

export const SPRINT_GUIDE = {
  en: [
    {
      h: 'What a sprint is',
      p: [
        'A sprint is one working week.',
        'It opens on Monday at 00:00 and freezes on Saturday at 12:00.',
        'The review meeting is on Saturday at 15:00.',
        'All times are Tashkent time.',
        'A new sprint opens every Monday by itself. Nobody creates it.',
      ],
    },
    {
      h: 'The board',
      p: [
        'There are four columns: To Do, In Progress, Blocked, Done.',
        'On a computer, drag a card to move it.',
        'On a phone, open the card and tap one of the four column buttons inside it.',
      ],
    },
    {
      h: 'Adding a task',
      p: [
        'Type a title in the To Do column and press Enter. The card now exists.',
        'Everything else is optional. Open the card to set the person, the deadline, the description, the checklist and files.',
      ],
    },
    {
      h: 'Deadlines',
      p: [
        'Every new task is given Saturday at 12:00 as its deadline.',
        'You can set an earlier date inside the card. Anybody can put the first real date on a task.',
        'Once a date is on a task it is a promise. Only a sprint owner can move it, or clear it. Ask one, and say what happened.',
        'Every move is written down under “What changed”, with who made it.',
        'A card shows a date only when that date is earlier than Saturday.',
      ],
    },
    {
      h: 'Finishing a task',
      p: ['Moving a card to Done asks what came out of it. You must give one of these three:'],
      list: [
        'A link that starts with http:// or https://',
        'A file',
        'Written text of at least 100 characters',
      ],
      after: ['The server checks this. A card cannot reach Done without one of them.'],
    },
    {
      h: 'Blocking a task',
      p: ['Moving a card to Blocked asks what it is waiting on. You must pick one of six reasons:'],
      list: [
        'Waiting on teammate',
        'Waiting on external party',
        'Budget or approval',
        'Scope was too big',
        'Priority changed',
        'Did not start',
      ],
      after: [
        'A note under the reason is optional.',
        'Moving the card out of Blocked clears the reason.',
      ],
    },
    {
      h: 'The freeze',
      p: [
        'After Saturday at 12:00 the sprint becomes read only.',
        'You cannot add, move, edit or delete a task in it.',
        'A sprint owner can still change it.',
        'Write new work in the Backlog instead. The Backlog never freezes.',
      ],
    },
    {
      h: 'The row of people',
      p: [
        'The row at the top is built from who holds a task this week. Nobody edits it.',
        'Give somebody a task and they appear. Take it away and they are gone.',
        'Each person shows finished out of assigned, for example 2/3.',
        'A red number is how many of their tasks are blocked.',
      ],
    },
    {
      h: 'The checklist',
      p: [
        'A checklist belongs to one task in one week.',
        'A task that runs for three weeks has three separate checklists.',
        'The sprint you are looking at shows only that week of items.',
      ],
    },
    {
      h: 'The Backlog',
      p: [
        'Anyone can write an idea in the Backlog.',
        'An idea has no person, no deadline and no checklist. It counts towards nothing.',
        'Only a sprint owner can promote an idea into the sprint.',
        'Promoting puts the idea in To Do and opens the card so the owner can set the person and the checklist.',
      ],
    },
    {
      h: 'Sprint owners',
      p: [
        'A sprint owner is a separate role. Being an admin of the board does not make you one.',
        'Owners can do four things nobody else can: promote an idea from the Backlog, change a sprint after it freezes, move a day somebody already promised, and put a dropped task back.',
      ],
    },
    {
      h: 'Dropping a task',
      p: [
        'A task you are not going to do is dropped, not deleted. Drop it from inside the card and say what happened.',
        'It leaves the board and stays on the week, under “Dropped this week”. The count of what was promised does not change. A week that promised twelve and dropped two reads as twelve promised and two dropped, for ever.',
        'A sprint owner can put it back.',
      ],
    },
    {
      h: 'What changed',
      p: [
        'Under the board is the list of everything that moved after the fact: deadlines pushed, tasks dropped and put back, cards pulled out of Done.',
        'Newest first, with the name of whoever did it. It is what the Saturday meeting reads when a number does not look like it did on Monday.',
      ],
    },
    {
      h: 'Growth',
      p: [
        'The growth switch marks a task as growth work.',
        'It shows as a green dot on the card. It changes nothing else.',
      ],
    },
  ],

  ru: [
    {
      h: 'Что такое спринт',
      p: [
        'Спринт это одна рабочая неделя.',
        'Он открывается в понедельник в 00:00 и замораживается в субботу в 12:00.',
        'Разбор недели проходит в субботу в 15:00.',
        'Всё время указано по Ташкенту.',
        'Новый спринт открывается каждый понедельник сам. Его никто не создаёт.',
      ],
    },
    {
      h: 'Доска',
      p: [
        'Колонок четыре: К работе, В работе, Заблокировано, Готово.',
        'На компьютере перетащите карточку, чтобы переместить её.',
        'На телефоне откройте карточку и нажмите одну из четырёх кнопок колонок внутри неё.',
      ],
    },
    {
      h: 'Как добавить задачу',
      p: [
        'Введите название в колонке «К работе» и нажмите Enter. Карточка создана.',
        'Всё остальное необязательно. Откройте карточку, чтобы указать исполнителя, срок, описание, чек-лист и файлы.',
      ],
    },
    {
      h: 'Сроки',
      p: [
        'Каждой новой задаче ставится срок: суббота, 12:00.',
        'Внутри карточки можно поставить более раннюю дату. Первую настоящую дату может поставить кто угодно.',
        'Как только дата стоит, это обещание. Передвинуть или убрать её может только владелец спринта. Попросите его и скажите, что случилось.',
        'Каждый перенос записывается в «Что изменилось» вместе с тем, кто его сделал.',
        'Дата показывается на карточке только если она раньше субботы.',
      ],
    },
    {
      h: 'Как завершить задачу',
      p: ['При переносе карточки в «Готово» спрашивают, что получилось. Нужно дать одно из трёх:'],
      list: [
        'Ссылку, которая начинается с http:// или https://',
        'Файл',
        'Текст не менее 100 символов',
      ],
      after: ['Это проверяет сервер. Без одного из трёх карточка в «Готово» не попадёт.'],
    },
    {
      h: 'Как заблокировать задачу',
      p: ['При переносе карточки в «Заблокировано» спрашивают, чего она ждёт. Нужно выбрать одну из шести причин:'],
      list: [
        'Ждём коллегу',
        'Ждём подрядчика или клиента',
        'Бюджет или согласование',
        'Объём оказался слишком большим',
        'Приоритет изменился',
        'Не начали',
      ],
      after: [
        'Комментарий под причиной необязателен.',
        'Когда карточка уходит из «Заблокировано», причина стирается.',
      ],
    },
    {
      h: 'Заморозка',
      p: [
        'После субботы 12:00 спринт становится доступен только для чтения.',
        'В нём нельзя добавить, переместить, изменить или удалить задачу.',
        'Владелец спринта менять его всё ещё может.',
        'Новое записывайте в «Идеи». Идеи не замораживаются никогда.',
      ],
    },
    {
      h: 'Ряд людей',
      p: [
        'Ряд наверху собирается из тех, у кого на этой неделе есть задача. Его никто не ведёт вручную.',
        'Дайте человеку задачу и он появится. Заберите её и он исчезнет.',
        'У каждого показано «сделано из назначенного», например 2/3.',
        'Красное число это сколько его задач заблокировано.',
      ],
    },
    {
      h: 'Чек-лист',
      p: [
        'Чек-лист принадлежит одной задаче в одной неделе.',
        'У задачи, которая идёт три недели, три отдельных чек-листа.',
        'В открытом спринте видны пункты только этой недели.',
      ],
    },
    {
      h: 'Идеи',
      p: [
        'Записать идею может кто угодно.',
        'У идеи нет исполнителя, срока и чек-листа. Она нигде не считается.',
        'Взять идею в спринт может только владелец спринта.',
        'При переносе идея попадает в «К работе», и карточка открывается, чтобы владелец указал исполнителя и чек-лист.',
      ],
    },
    {
      h: 'Владельцы спринта',
      p: [
        'Владелец спринта это отдельная роль. Права администратора доски её не дают.',
        'Владелец может четыре вещи, недоступные остальным: взять идею в спринт, менять спринт после заморозки, передвинуть уже обещанную дату и вернуть снятую задачу.',
      ],
    },
    {
      h: 'Как снять задачу',
      p: [
        'Задачу, которую делать не будут, снимают, а не удаляют. Снимите её из карточки и скажите, что случилось.',
        'Она уходит с доски и остаётся на неделе, в разделе «Сняли на этой неделе». Число обещанного не меняется: неделя, которая обещала двенадцать и сняла две, навсегда читается как двенадцать обещанных и две снятых.',
        'Владелец спринта может вернуть её обратно.',
      ],
    },
    {
      h: 'Что изменилось',
      p: [
        'Под доской список всего, что поменяли задним числом: перенесённые сроки, снятые и возвращённые задачи, карточки, вынутые из «Готово».',
        'Сначала свежее, с именем того, кто это сделал. Именно это читают в субботу, когда число выглядит не так, как в понедельник.',
      ],
    },
    {
      h: 'Рост',
      p: [
        'Переключатель «Рост» помечает задачу как работу на рост.',
        'На карточке это зелёная точка. Больше ничего не меняется.',
      ],
    },
  ],

  uz: [
    {
      h: 'Sprint nima',
      p: [
        'Sprint bu bitta ish haftasi.',
        'U dushanba kuni soat 00:00 da ochiladi va shanba kuni soat 12:00 da muzlatiladi.',
        'Haftaning tahlili shanba kuni soat 15:00 da boʻladi.',
        'Barcha vaqtlar Toshkent vaqti.',
        'Yangi sprint har dushanba oʻzi ochiladi. Uni hech kim yaratmaydi.',
      ],
    },
    {
      h: 'Doska',
      p: [
        'Toʻrtta ustun bor: Bajarish kerak, Jarayonda, Bloklangan, Tayyor.',
        'Kompyuterda kartochkani sudrab koʻchiring.',
        'Telefonda kartochkani oching va uning ichidagi toʻrt ustun tugmasidan birini bosing.',
      ],
    },
    {
      h: 'Vazifa qoʻshish',
      p: [
        '«Bajarish kerak» ustunida nom yozing va Enter bosing. Kartochka tayyor.',
        'Qolgani ixtiyoriy. Masʼul, muddat, tavsif, nazorat roʻyxati va fayllarni kartochka ichida belgilang.',
      ],
    },
    {
      h: 'Muddatlar',
      p: [
        'Har bir yangi vazifaga shanba soat 12:00 muddat qilib qoʻyiladi.',
        'Kartochka ichida undan erta sana qoʻyish mumkin. Birinchi haqiqiy sanani istalgan kishi qoʻya oladi.',
        'Sana qoʻyilgandan keyin u vaʼda boʻladi: uni faqat sprint egasi koʻchira yoki oʻchira oladi. Undan soʻrang va nima boʻlganini ayting.',
        'Har bir koʻchirish «Nima oʻzgardi» boʻlimiga, kim qilgani bilan birga yoziladi.',
        'Sana kartochkada faqat shanbadan erta boʻlsa koʻrinadi.',
      ],
    },
    {
      h: 'Vazifani yakunlash',
      p: ['Kartochkani «Tayyor» ga oʻtkazganda nima natija boʻlgani soʻraladi. Uch narsadan birini berish shart:'],
      list: [
        'http:// yoki https:// bilan boshlanadigan havola',
        'Fayl',
        'Kamida 100 belgidan iborat matn',
      ],
      after: ['Buni server tekshiradi. Ularsiz kartochka «Tayyor» ga oʻtmaydi.'],
    },
    {
      h: 'Vazifani bloklash',
      p: ['Kartochkani «Bloklangan» ga oʻtkazganda nimani kutayotgani soʻraladi. Olti sababdan birini tanlash shart:'],
      list: [
        'Hamkasbni kutyapmiz',
        'Pudratchi yoki mijozni kutyapmiz',
        'Byudjet yoki tasdiq',
        'Hajmi juda katta boʻldi',
        'Ustuvorlik oʻzgardi',
        'Boshlanmadi',
      ],
      after: [
        'Sabab ostidagi izoh ixtiyoriy.',
        'Kartochka «Bloklangan» dan chiqsa, sabab oʻchiriladi.',
      ],
    },
    {
      h: 'Muzlatish',
      p: [
        'Shanba soat 12:00 dan keyin sprint faqat oʻqish uchun boʻlib qoladi.',
        'Unda vazifa qoʻshib, koʻchirib, oʻzgartirib yoki oʻchirib boʻlmaydi.',
        'Sprint egasi uni hali ham oʻzgartira oladi.',
        'Yangi ishni «Gʻoyalar» ga yozing. Gʻoyalar hech qachon muzlatilmaydi.',
      ],
    },
    {
      h: 'Odamlar qatori',
      p: [
        'Yuqoridagi qator shu hafta vazifasi bor odamlardan yigʻiladi. Uni hech kim qoʻlda yuritmaydi.',
        'Odamga vazifa bering va u paydo boʻladi. Olib qoʻysangiz, yoʻqoladi.',
        'Har birida «bajarilgani berilganidan» koʻrsatiladi, masalan 2/3.',
        'Qizil raqam uning nechta vazifasi bloklanganini bildiradi.',
      ],
    },
    {
      h: 'Nazorat roʻyxati',
      p: [
        'Nazorat roʻyxati bitta haftadagi bitta vazifaga tegishli.',
        'Uch hafta davom etgan vazifada uchta alohida roʻyxat boʻladi.',
        'Ochilgan sprintda faqat oʻsha haftaning bandlari koʻrinadi.',
      ],
    },
    {
      h: 'Gʻoyalar',
      p: [
        'Gʻoyani xohlagan odam yozib qoʻyishi mumkin.',
        'Gʻoyada masʼul, muddat va nazorat roʻyxati yoʻq. U hech qayerda hisoblanmaydi.',
        'Gʻoyani sprintga faqat sprint egasi ola oladi.',
        'Olinganda gʻoya «Bajarish kerak» ga tushadi va kartochka ochiladi, ega masʼul va roʻyxatni belgilaydi.',
      ],
    },
    {
      h: 'Sprint egalari',
      p: [
        'Sprint egasi alohida rol. Doska administratori boʻlish uni bermaydi.',
        'Ega toʻrt ishni qila oladi: gʻoyani sprintga olish, muzlatilgandan keyin sprintni oʻzgartirish, allaqachon vaʼda qilingan sanani koʻchirish va olib tashlangan vazifani qaytarish.',
      ],
    },
    {
      h: 'Vazifani olib tashlash',
      p: [
        'Qilinmaydigan vazifa oʻchirilmaydi, balki olib tashlanadi. Kartochka ichidan olib tashlang va nima boʻlganini ayting.',
        'U doskadan chiqadi, lekin «Bu hafta olib tashlanganlar» boʻlimida haftada qoladi. Vaʼda qilinganlar soni oʻzgarmaydi: oʻn ikkitani vaʼda qilib ikkitasini olib tashlagan hafta abadiy oʻn ikki vaʼda va ikki olib tashlangan boʻlib oʻqiladi.',
        'Sprint egasi uni qaytara oladi.',
      ],
    },
    {
      h: 'Nima oʻzgardi',
      p: [
        'Doska ostida keyinchalik oʻzgartirilgan hamma narsa roʻyxati: koʻchirilgan muddatlar, olib tashlangan va qaytarilgan vazifalar, «Tayyor» dan chiqarilgan kartochkalar.',
        'Yangisi birinchi, kim qilgani ismi bilan. Shanba yigʻilishida son dushanbadagidek koʻrinmasa, aynan shu oʻqiladi.',
      ],
    },
    {
      h: 'Oʻsish',
      p: [
        '«Oʻsish» tugmasi vazifani oʻsish ishi deb belgilaydi.',
        'Kartochkada bu yashil nuqta. Boshqa hech nima oʻzgarmaydi.',
      ],
    },
  ],
}
