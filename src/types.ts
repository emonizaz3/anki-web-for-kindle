export interface Deck {
  id: string;
  name: string;
  totalCards?: number;
  dueCards?: number;
}

export interface Card {
  id: string;
  front: string;
  back: string;
  deckId: string;
  interval: number;
  repetition: number;
  easeFactor: number;
  nextReview: number;
}
