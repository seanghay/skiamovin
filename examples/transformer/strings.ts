// On-screen text and subtitles for the Transformer film, in English and Khmer. Subtitle times are in seconds.
export type Lang = 'en' | 'km';

interface Strings {
  title: string;
  vocab: string;
  dims: string;
  whatIsIt: string;
  sameScores: string;
  nowDifferent: string;
  scoreSame: string;
  scoreChanges: string;
  pair: string;
  scoreNote: string;
  heads: string;
  headsNote: string;
  parts: [string, string, string, string, string, string];
  model: string;
  illustrative: string;
  chapters: [string, string, string, string, string, string, string];
  sources: string;
  credits: string;
  createdBy: string;
  subtitles: [number, number, string][];
}

const MODEL = 'Llama 3 8B · 4,096 dims · 32 heads · 128,256 tokens';
const CREDITS = 'Music: “Infinite Wonder” by Kevin MacLeod (CC0)';

export const STRINGS: Record<Lang, Strings> = {
  en: {
    title: 'How does a Transformer work?',
    vocab: 'One of 128,256 tokens in Llama 3',
    dims: '4,096 numbers per token',
    whatIsIt: 'what is “it”?',
    sameScores: 'Swapped, yet the same attention scores',
    nowDifferent: 'With RoPE, “dog” first and “dog” last are different',
    scoreSame: 'Both moved by 4: the score stays the same',
    scoreChanges: 'Only k moved: the distance changed, so the score did too',
    pair: 'Pair',
    scoreNote: 'Rotating both by position leaves only the distance n − m in the score.',
    heads: '32 heads per layer',
    headsNote: 'Each head learns its own pattern',
    parts: [
      'RMSNorm',
      'Attention with RoPE',
      'Add back the input',
      'RMSNorm',
      'Feed-forward (SwiGLU)',
      'Add back the input',
    ],
    model: MODEL,
    illustrative: 'Illustrative probabilities',
    chapters: ['Tokens', 'Embeddings', 'Attention', 'RoPE', 'Scores', 'Layers', 'Prediction'],
    sources: 'Vaswani et al., 2017 · RoPE: Su et al., 2021',
    credits: CREDITS,
    createdBy: 'Created by',
    subtitles: [
      [0.6, 3.4, 'When you type to a language model, it does one thing:'],
      [3.4, 7.6, 'it guesses the next word. So how does it guess?'],
      [8.4, 12.4, 'First, the text is cut into pieces called tokens.'],
      [12.4, 16.6, 'Each token is just a number, out of 128,256 in Llama 3.'],
      [17.2, 21.4, 'Each number looks up a vector of 4,096 values,'],
      [21.4, 25.6, 'which the model learned to stand for that token’s meaning.'],
      [26.4, 29.8, 'But a word’s meaning depends on the words around it.'],
      [29.8, 34.4, 'Attention lets each token look back at the tokens before it.'],
      [34.4, 38.6, 'To understand “it”, the model looks mostly at “animal”.'],
      [39.4, 43.4, 'But attention alone can’t see word order: “dog bites man” scores like “man bites dog”.'],
      [43.4, 47.8, 'RoPE fixes this: it turns each query and key by an angle set by its position.'],
      [47.8, 51.8, 'Move two words together and their angle stays the same, so the score depends only on distance.'],
      [51.8, 55.8, 'Each of the 64 pairs in a head turns at its own speed, like the hands of a clock.'],
      [56.2, 60.8, 'Query times key gives a score; softmax turns scores into weights.'],
      [60.8, 66.6, 'Tokens can only look back, and many heads do this in parallel.'],
      [67.4, 72.4, 'Attention and a feed-forward network make one layer.'],
      [72.4, 78.4, 'Llama 3 8B stacks 32 of them, each refining the vectors.'],
      [79.4, 84.2, 'At the end, every token in the vocabulary gets a probability.'],
      [84.2, 89.6, 'Pick one, add it to the text, and run again. One token at a time.'],
    ],
  },
  km: {
    title: 'Transformer ដំណើរការយ៉ាងដូចម្តេច?',
    vocab: 'token មួយក្នុងចំណោម 128,256 របស់ Llama 3',
    dims: 'token នីមួយៗ មានលេខ 4,096',
    whatIsIt: 'តើ «it» សំដៅលើអ្វី?',
    sameScores: 'ប្តូរទីតាំង តែពិន្ទុ attention នៅដដែល',
    nowDifferent: 'ជាមួយ RoPE «dog» នៅខាងមុខ និង «dog» នៅខាងក្រោយ ខុសគ្នា',
    scoreSame: 'ផ្លាស់ទីទាំងពីរ 4 ជំហាន៖ ពិន្ទុនៅដដែល',
    scoreChanges: 'ផ្លាស់ទីតែ k៖ ចម្ងាយប្តូរ ពិន្ទុក៏ប្តូរដែរ',
    pair: 'គូទី',
    scoreNote: 'ពេលបង្វិលទាំងពីរតាមទីតាំង ពិន្ទុនៅសល់តែចម្ងាយ n − m ប៉ុណ្ណោះ។',
    heads: 'head ចំនួន 32 ក្នុងមួយស្រទាប់',
    headsNote: 'head នីមួយៗ រៀនលំនាំផ្ទាល់ខ្លួន',
    parts: [
      'RMSNorm',
      'Attention ជាមួយ RoPE',
      'បូកបញ្ចូលទិន្នន័យដើមវិញ',
      'RMSNorm',
      'Feed-forward (SwiGLU)',
      'បូកបញ្ចូលទិន្នន័យដើមវិញ',
    ],
    model: MODEL,
    illustrative: 'ប្រូបាប៊ីលីតេ ជាឧទាហរណ៍',
    chapters: ['Token', 'វ៉ិចទ័រ', 'Attention', 'RoPE', 'ពិន្ទុ', 'ស្រទាប់', 'ការទាយ'],
    sources: 'Vaswani et al., 2017 · RoPE៖ Su et al., 2021',
    credits: CREDITS,
    createdBy: 'បង្កើតដោយ',
    subtitles: [
      [0.6, 3.4, 'ពេលអ្នកវាយអត្ថបទទៅម៉ូដែលភាសា វាធ្វើតែរឿងមួយ៖'],
      [3.4, 7.6, 'ទាយពាក្យបន្ទាប់។ តើវាទាយដោយរបៀបណា?'],
      [8.4, 12.4, 'ដំបូង អត្ថបទត្រូវបានកាត់ជាបំណែកតូចៗ ហៅថា token។'],
      [12.4, 16.6, 'token នីមួយៗ គ្រាន់តែជាលេខមួយ ក្នុងចំណោម 128,256 របស់ Llama 3។'],
      [17.2, 21.4, 'លេខនីមួយៗ ទៅយកវ៉ិចទ័រមួយ ដែលមានតម្លៃ 4,096'],
      [21.4, 25.6, 'ដែលម៉ូដែលបានរៀន ដើម្បីតំណាងឱ្យអត្ថន័យរបស់ token នោះ។'],
      [26.4, 29.8, 'ប៉ុន្តែ អត្ថន័យរបស់ពាក្យ អាស្រ័យលើពាក្យនៅជុំវិញវា។'],
      [29.8, 34.4, 'Attention អនុញ្ញាតឱ្យ token នីមួយៗ មើលទៅ token មុនៗ។'],
      [34.4, 38.6, 'ដើម្បីយល់ពាក្យ «it» ម៉ូដែលផ្តោតភាគច្រើនទៅលើ «animal»។'],
      [39.4, 43.4, 'ប៉ុន្តែ attention តែឯង មិនដឹងលំដាប់ពាក្យទេ៖ «dog bites man» ទទួលពិន្ទុដូច «man bites dog»។'],
      [43.4, 47.8, 'RoPE ដោះស្រាយបញ្ហានេះ៖ វាបង្វិល query និង key នីមួយៗ តាមមុំដែលកំណត់ដោយទីតាំង។'],
      [47.8, 51.8, 'ផ្លាស់ទីពាក្យពីរទៅជាមួយគ្នា មុំរវាងវានៅដដែល ដូច្នេះពិន្ទុអាស្រ័យតែលើចម្ងាយ។'],
      [51.8, 55.8, 'គូទាំង 64 ក្នុង head មួយ វិលក្នុងល្បឿនខុសៗគ្នា ដូចទ្រនិចនាឡិកា។'],
      [56.2, 60.8, 'query គុណនឹង key ផ្តល់ពិន្ទុ ហើយ softmax ប្តូរពិន្ទុទៅជាទម្ងន់។'],
      [60.8, 66.6, 'token មើលបានតែទៅក្រោយ ហើយ head ជាច្រើនធ្វើការនេះស្របគ្នា។'],
      [67.4, 72.4, 'Attention និង feed-forward network ផ្សំគ្នាជាស្រទាប់មួយ។'],
      [72.4, 78.4, 'Llama 3 8B មានស្រទាប់បែបនេះ 32 ជាន់ ដែលនីមួយៗកែលម្អវ៉ិចទ័របន្តិចម្តងៗ។'],
      [79.4, 84.2, 'នៅចុងបញ្ចប់ token ទាំងអស់ក្នុងវាក្យសព្ទ ទទួលបានប្រូបាប៊ីលីតេ។'],
      [84.2, 89.6, 'ជ្រើសយកមួយ បន្ថែមទៅអត្ថបទ ហើយដំណើរការម្តងទៀត។ ម្តងមួយ token។'],
    ],
  },
};
