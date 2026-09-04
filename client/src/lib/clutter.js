// Not offering what nobody can use.
//
// A filter with nothing behind it is a button that does nothing: pressing
// "Telegram Uzb · 0" empties the page and teaches a person not to press
// things. For an ADMIN that empty pill is worth keeping — a channel with no
// work on it is a fact about the board they run, and a fact has to be visible
// to be noticed. For everybody else it is furniture.
//
// The filter somebody is STANDING ON is always offered, whatever its count:
// taking it away while it is selected would move the page under them.
export const offerFilter = (user, n, selected = false) =>
  selected || (Number(n) || 0) > 0 || user?.role === 'admin'
