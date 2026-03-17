import React from 'react';
import CardDeck, { type CardDeckProps } from './CardDeck';

/**
 * WorkerCardDeck — worker-facing named wrapper around CardDeck.
 * Keeps API identical while providing a stable domain name for imports.
 */
const WorkerCardDeck: React.FC<CardDeckProps> = (props) => <CardDeck {...props} />;

export type { CardDeckProps, CardDeckProps as WorkerCardDeckProps };
export default WorkerCardDeck;
