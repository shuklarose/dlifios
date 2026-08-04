// Questions with the article that should answer them.
//
// Every expectation is checked against an article that exists in the corpus,
// and the wording avoids the article's own title where possible: a question
// that repeats the heading tests string overlap rather than retrieval.

export interface EvalCase {
  question: string;
  act: string;
  article: number;
}

export const EVAL_SET: EvalCase[] = [
  // GDPR, obligations
  { question: "What are the lawful bases for processing personal data?", act: "GDPR", article: 6 },
  { question: "When do I need to carry out a data protection impact assessment?", act: "GDPR", article: 35 },
  { question: "How quickly must a breach be reported to the regulator?", act: "GDPR", article: 33 },
  { question: "When do I have to tell affected individuals about a breach?", act: "GDPR", article: 34 },
  { question: "What security measures does the regulation require?", act: "GDPR", article: 32 },
  { question: "Do I have to keep a record of what personal data I process?", act: "GDPR", article: 30 },
  { question: "When must an organisation appoint a data protection officer?", act: "GDPR", article: 37 },
  { question: "What has to be in a contract with a company that processes data for me?", act: "GDPR", article: 28 },
  { question: "What does privacy by design require in practice?", act: "GDPR", article: 25 },

  // GDPR, individual rights
  { question: "Can someone ask me to delete their data?", act: "GDPR", article: 17 },
  { question: "Can a person request a copy of the data I hold about them?", act: "GDPR", article: 15 },
  { question: "Can someone ask to move their data to another provider?", act: "GDPR", article: 20 },
  { question: "Can an individual refuse to have their data used for direct marketing?", act: "GDPR", article: 21 },
  { question: "Is a decision made purely by an algorithm allowed?", act: "GDPR", article: 22 },
  { question: "What must I tell people when I collect their data directly?", act: "GDPR", article: 13 },

  // GDPR, conditions and definitions
  { question: "What makes consent valid?", act: "GDPR", article: 7 },
  { question: "Can I process data about someone's health or religion?", act: "GDPR", article: 9 },
  { question: "At what age can a child consent to an online service?", act: "GDPR", article: 8 },
  { question: "What are the core principles governing personal data?", act: "GDPR", article: 5 },

  // GDPR, transfers and enforcement
  { question: "Can I send personal data outside the EU?", act: "GDPR", article: 44 },
  { question: "What safeguards allow an international transfer without an adequacy decision?", act: "GDPR", article: 46 },
  { question: "How large can a fine be?", act: "GDPR", article: 83 },

  // AI Act
  { question: "Which uses of artificial intelligence are banned outright?", act: "AI_ACT", article: 5 },
  { question: "How do I tell whether my AI system counts as high risk?", act: "AI_ACT", article: 6 },
  { question: "What information must I give to someone deploying my AI system?", act: "AI_ACT", article: 13 },
  { question: "Does a person have to supervise a high-risk AI system?", act: "AI_ACT", article: 14 },
  { question: "What are the requirements around training data quality?", act: "AI_ACT", article: 10 },
  { question: "Do I have to tell users they are talking to a machine?", act: "AI_ACT", article: 50 },
  { question: "What obligations apply to general-purpose AI models?", act: "AI_ACT", article: 53 },
  { question: "What penalties apply for breaching the AI rules?", act: "AI_ACT", article: 99 },
];
