import { chat, chat_metadata, eventSource, event_types, getCurrentChatId, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../popup.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { isTrueBoolean } from '../../../utils.js';
import { Chart, registerables } from './lib/chartjs/chart.esm.js';

Chart.register(...registerables);

let isActive = false;
let consecutive = extension_settings.wordFrequency?.consecutive ?? [1,2,3];
let movingAverage = extension_settings.wordFrequency?.movingAverage ?? 10;
let movingAverageInput;
let frequencyPerWords = extension_settings.wordFrequency?.frequencyPerWords ?? 10;
let frequencyPerWordsInput;
/**@type {HTMLElement} */
let dom;
let domChartContainer;
let domList;
let allWords;
let words;
/**@type {{id:number, text:string, words:string[]}[]} */
let allMessages;
const colors = [
    'silver',
    'red',
    'green',
    'magenta',
    'yellow',
    'orange',
    'blue',
    'purple',
    'black',
];
let selected = [];
const show = ()=>{
    dom?.remove();
    dom = document.createElement('div'); {
        dom.id = 'stwf--root';
        dom.classList.add('draggable');
        const actions = document.createElement('div'); {
            actions.classList.add('stwf--actions');
            const controls = document.createElement('div'); {
                controls.classList.add('stwf--controls');
                const ma = document.createElement('label'); {
                    ma.append('Moving Average: ');
                    const inp = document.createElement('input'); {
                        movingAverageInput = inp;
                        inp.classList.add('text_pole');
                        inp.type = 'number';
                        inp.value = movingAverage;
                        inp.addEventListener('change', ()=>setMovingAverage(inp.value));
                        ma.append(inp);
                    }
                    controls.append(ma);
                }
                const perWords = document.createElement('label'); {
                    const inp = document.createElement('input'); {
                        frequencyPerWordsInput = inp;
                        inp.type = 'checkbox';
                        inp.checked = frequencyPerWords;
                        inp.addEventListener('click', ()=>setFrequencyPerWords(inp.checked));
                        perWords.append(inp);
                    }
                    perWords.append('Freq. per words');
                    controls.append(perWords);
                }
                const commonBtn = document.createElement('div'); {
                    commonBtn.classList.add('menu_button');
                    commonBtn.classList.add('fa-solid', 'fa-book');
                    commonBtn.title = 'Common Words / Excluded Words';
                    commonBtn.addEventListener('click', ()=>{
                        const list = document.createElement('ul'); {
                            list.classList.add('stwf--common');
                            for (const word of (chat_metadata.wordFrequency?.common ?? [])) {
                                const li = document.createElement('li'); {
                                    li.classList.add('stwf--item');
                                    li.textContent = word;
                                    li.title = 'Click to remove';
                                    li.addEventListener('click', ()=>{
                                        if (chat_metadata.wordFrequency.common.includes(word)) {
                                            chat_metadata.wordFrequency.common.splice(chat_metadata.wordFrequency.common.indexOf(word), 1);
                                            li.remove();
                                            saveMetadataDebounced();
                                            update();
                                        }
                                    });
                                    list.append(li);
                                }
                            }
                        }
                        const dlg = new Popup(list, POPUP_TYPE.TEXT, null, { okButton:'Close' });
                        dlg.show();
                    });
                    controls.append(commonBtn);
                }
                actions.append(controls);
            }
            const close = document.createElement('div'); {
                close.classList.add('stwf--close');
                close.classList.add('stwf--action');
                close.classList.add('fa-solid');
                close.classList.add('fa-circle-xmark');
                close.title = 'Close';
                close.addEventListener('click', ()=>hide());
                actions.append(close);
            }
            dom.append(actions);
        }
        const chartContainer = document.createElement('div'); {
            domChartContainer = chartContainer;
            chartContainer.classList.add('stwf--chart');
            dom.append(chartContainer);
        }
        const list = document.createElement('div'); {
            domList = list;
            list.classList.add('stwf--list');
            dom.append(list);
        }
        document.body.append(dom);
    }
    isActive = true;
    update();
};
const hide = ()=>{
    isActive = false;
    dom?.remove();
};
const getWords = ()=>{
    allWords = [];
    const sentenceSegmenter = new Intl.Segmenter('en', { granularity:'sentence' });
    const wordSegmenter = new Intl.Segmenter('en', { granularity:'word' });
    allMessages = [];
    chat.forEach((mes,idx)=>{
        if (mes.is_system || mes.is_user) return;
        const item = {
            id: idx,
            text: mes.mes
                // remove codeblocks
                .split('```').filter((_,idx)=>idx % 2 == 0).join('')
                // remove contractions at end of words ("Alice's" -> "Alice")
                .replace(/('s|'d|'ve|n't)\b/g, '')
            ,
            words: [],
        };
        allMessages.push(item);
        const allSentences = Array.from(sentenceSegmenter.segment(item.text)).map(it=>it.segment);
        for (const s of allSentences) {
            const words = Array.from(wordSegmenter.segment(s))
                .filter(it=>it.isWordLike)
                .map(it=>it.segment.trim().toLowerCase())
            ;
            for (const num of consecutive) {
                if (num == 1) item.words.push(...words);
                else {
                    for (let i = 0; i + num <= words.length; i++) {
                        item.words.push(words.slice(i, i + num).join(' '));
                    }
                }
            }
        }
        allWords.push(...item.words);
    });
    return allWords;
};
const processWords = (allWords)=>{
    allWords = allWords.filter(it=>!chat_metadata.wordFrequency.common.includes(it));
    let dict = {};
    for (let w of allWords) {
        if (!dict[w]) dict[w] = 0;
        dict[w]++;
    }
    words = Object.keys(dict).map(w=>({ word:w, count:dict[w] }));
    words.sort((a,b)=>b.count - a.count);
    words = words.filter(it=>it.word.length >= 3);
    return words;
};
const render = (words)=>{
    domList.innerHTML = '';
    let max;
    for (const word of words.filter((it,idx)=>idx < 100 || selected.includes(it.word))) {
        if (!max) max = word.count;
        const item = document.createElement('div'); {
            item.classList.add('stwf--item');
            item.title = 'Click to show/hide frequency over time.\nRight-click to add to blocklist.';
            item.textContent = `${word.word} (${word.count})`;
            item.style.background = `linear-gradient(90deg, var(--SmartThemeBotMesBlurTintColor) 0%, var(--SmartThemeBotMesBlurTintColor) ${word.count / max * 100}%, transparent ${word.count / max * 100}%, transparent 100%)`;
            if (selected.includes(word.word)) {
                item.classList.add('stwf--selected');
            }
            item.addEventListener('contextmenu', (evt)=>{
                evt.preventDefault();
                if (!chat_metadata.wordFrequency) chat_metadata.wordFrequency = { common: [] };
                if (chat_metadata.wordFrequency.common.includes(word.word)) {
                    // Already common, do nothing
                } else {
                    chat_metadata.wordFrequency.common.push(word.word);
                }
                saveMetadataDebounced();
                update();
            });
            item.addEventListener('click', ()=>{
                if (selected.includes(word.word)) {
                    selected.splice(selected.indexOf(word.word), 1);
                    item.classList.remove('stwf--selected');
                } else {
                    selected.push(word.word);
                    item.classList.add('stwf--selected');
                }
                updateChart();
            });
            domList.append(item);
        }
    }
};
const updateChart = ()=>{
    domChartContainer.innerHTML = '';
    if (selected.length > 0) {
        const style = window.getComputedStyle(domChartContainer);
        Chart.defaults.borderColor = style.getPropertyValue('--SmartThemeBorderColor');
        Chart.defaults.color = style.getPropertyValue('--SmartThemeEmColor');
        colors[0] = style.getPropertyValue('--SmartThemeQuoteColor');
        const canvas = document.createElement('canvas');
        canvas.classList.add('stwf--chartCanvas');
        domChartContainer.append(canvas);
        const dataSets = [];
        for (const word of selected) {
            const first = allMessages.findIndex(it=>it.words.includes(word));
            const last = allMessages.findLastIndex(it=>it.words.includes(word));
            const data = [];
            const range = movingAverage > 0 ? movingAverage : allMessages.length;

            for (let idx = 0; idx < allMessages.length; idx++) {
                const startSlice = Math.max(0, idx - range + 1);
                const endSlice = idx + 1;
                const windowMessages = allMessages.slice(startSlice, endSlice);
                
                let totalOccurrences = 0;
                let totalWords = 0;

                windowMessages.forEach(it => {
                    totalOccurrences += it.words.filter(w => w === word).length;
                    if (frequencyPerWords) {
                        totalWords += it.words.length;
                    }
                });

                if (frequencyPerWords && totalWords === 0) {
                    data.push(0);
                    continue;
                }
                
                const freq = frequencyPerWords ? totalOccurrences / totalWords : totalOccurrences / windowMessages.length;
                data.push(freq);
            }

            dataSets.push({
                label: word,
                data,
                fill: false,
                borderColor: colors[dataSets.length % colors.length],
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 2,
            });
        }
        const chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: allMessages.map((it,idx)=>idx),
                datasets: dataSets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Message #',
                        },
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: frequencyPerWords ? 'Frequency per 100 words' : 'Frequency per message',
                        },
                        ticks: {
                            callback: function(value, index, values) {
                                return frequencyPerWords ? (Number(value) * 100).toFixed(2) + '%' : Number(value).toFixed(2);
                            }
                        }
                    },
                },
            },
        });
    }
};
const update = ()=>{
    if (!isActive) return;
    if (getCurrentChatId() === undefined) return hide();
    if (!chat_metadata.wordFrequency) {
        chat_metadata.wordFrequency = { common:[] };
        saveMetadataDebounced();
    }
    const allWords = getWords();
    const words = processWords(allWords);
    render(words);
    updateChart();
};

eventSource.on(event_types.USER_MESSAGE_RENDERED, ()=>update());
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, ()=>update());
eventSource.on(event_types.CHAT_CHANGED, ()=>update());
eventSource.on(event_types.MESSAGE_EDITED, ()=>update());
eventSource.on(event_types.MESSAGE_DELETED, ()=>update());


registerSlashCommand('wordfrequency',
    (args, value)=>{
        if (isActive) hide();
        else show();
    },
    [],
    '<span class="monospace"></span> – Show / hide word frequency panel.',
    true,
    true,
);
registerSlashCommand('wordfrequency-consecutive',
    (args, value)=>{
        if (value?.trim()) {
            const list = JSON.parse(value);
            if (!extension_settings.wordFrequency) extension_settings.wordFrequency = {};
            extension_settings.wordFrequency.consecutive = list;
            consecutive = extension_settings.wordFrequency.consecutive;
            saveSettingsDebounced();
            update();
        } else {
            return JSON.stringify(consecutive);
        }
    },
    [],
    '<span class="monospace">(listOfNumbers)</span> – Set number of consecutive words to check. Example: <code>/wordfrequency-consecutive [1,2,3]</code> to check individual words as well as one-word and two-word sequences.',
    true,
    true,
);
const setMovingAverage = (value)=>{
    if (!extension_settings.wordFrequency) extension_settings.wordFrequency = {};
    if (movingAverageInput) movingAverageInput.value = value;
    extension_settings.wordFrequency.movingAverage = Number(value.trim());
    movingAverage = extension_settings.wordFrequency.movingAverage;
    saveSettingsDebounced();
    updateChart();
};
registerSlashCommand('wordfrequency-movingaverage',
    (args, value)=>{
        if (value?.trim()) {
            setMovingAverage(value);
        } else {
            return JSON.stringify(movingAverage);
        }
    },
    [],
    '<span class="monospace">(number)</span> – Set range of the moving average for the frequency chart. Set to <code>0</code> to use a cumulative average. Call without value to return the current setting.',
    true,
    true,
);

registerSlashCommand('wordfrequency-common',
    (args, value)=>{
        if (isTrueBoolean(args.clear)) {
            if (value?.trim()) {
                if (chat_metadata.wordFrequency.common.includes(value.trim())) {
                    chat_metadata.wordFrequency.common.splice(chat_metadata.wordFrequency.common.indexOf(value.trim()), 1);
                }
            } else {
                chat_metadata.wordFrequency.common = [];
            }
            saveMetadataDebounced();
            update();
        } else {
            return JSON.stringify(chat_metadata.wordFrequency.common);
        }
    },
    [],
    '<span class="monospace">[optional clear=true] (optional word)</span> – Show blocklist. Use <code>clear=true</code> to remove all "common" words / sequences, or a single common word / sequence from the blocklist.',
    true,
    true,
);

registerSlashCommand('wordfrequency-select',
    (args, value)=>{
        if (selected.includes(value)) {
            selected.splice(selected.indexOf(value), 1);
            Array.from(document.querySelectorAll('.stwf--item')).find(it=>it.textContent.replace(/ \(\d+\)$/,'') == value)?.classList?.remove('stwf--selected');
        } else {
            selected.push(value);
            Array.from(document.querySelectorAll('.stwf--item')).find(it=>it.textContent.replace(/ \(\d+\)$/,'') == value)?.classList?.add('stwf--selected');
        }
        updateChart();
    },
    [],
    '<span class="monospace">(word)</span> – Add / remove a word or sequence from the chart.',
    true,
    true,
);

const setFrequencyPerWords = (value)=>{
    if (!extension_settings.wordFrequency) extension_settings.wordFrequency = {};
    if (frequencyPerWordsInput) frequencyPerWordsInput.checked = Boolean(value);
    extension_settings.wordFrequency.frequencyPerWords = Boolean(value);
    frequencyPerWords = extension_settings.wordFrequency.frequencyPerWords;
    saveSettingsDebounced();
    updateChart();
};


// ------------------- NEW COMMAND START -------------------
registerSlashCommand('wordfrequency-block',
    (args, value) => {
        const injectionId = 'wordFrequencyBlocker';

        // Logic to clear the injection
        if (isTrueBoolean(args.clear)) {
            if (chat_metadata.prompt_injects) {
                const index = chat_metadata.prompt_injects.findIndex(inj => inj.id === injectionId);
                if (index !== -1) {
                    chat_metadata.prompt_injects.splice(index, 1);
                    saveMetadataDebounced();
                    new Popup('Repetitive phrase blocker injection has been removed.', POPUP_TYPE.INFO).show();
                } else {
                    new Popup('No active phrase blocker injection to remove.', POPUP_TYPE.INFO).show();
                }
            }
            return;
        }

        // Get arguments with defaults
        const count = Number(args.count ?? 5);
        let range;
        try {
            range = JSON.parse(args.range ?? '[2,3]');
            if (!Array.isArray(range)) throw new Error();
        } catch {
            new Popup('Invalid "range" argument. It must be a valid JSON array, e.g., <code>[2,3]</code>.', POPUP_TYPE.ERROR).show();
            return;
        }

        // Process the chat to get the latest word frequencies
        const allWords = getWords();
        const processedWords = processWords(allWords);

        // Filter phrases by the specified range (number of words in the phrase)
        // and take the top 'count'
        const phrasesToBlock = processedWords
            .filter(item => {
                const wordCount = item.word.split(' ').length;
                return range.includes(wordCount);
            })
            .slice(0, count)
            .map(item => `"${item.word}"`);

        if (phrasesToBlock.length === 0) {
            new Popup(`No phrases found within the specified range: <code>${JSON.stringify(range)}</code>.`, POPUP_TYPE.INFO).show();
            return;
        }

        // Construct the prompt to be injected
        const promptText = `(System: Your responses are becoming repetitive. Avoid using the following phrases: ${phrasesToBlock.join(', ')})`;

        // Ensure the prompt_injects array exists
        if (!chat_metadata.prompt_injects) {
            chat_metadata.prompt_injects = [];
        }

        // Find if an injection with our ID already exists
        const existingInjection = chat_metadata.prompt_injects.find(inj => inj.id === injectionId);

        if (existingInjection) {
            // Update existing injection
            existingInjection.text = promptText;
        } else {
            // Add new injection
            chat_metadata.prompt_injects.push({
                id: injectionId,
                text: promptText,
                role: 'user', // As requested
                ephemeral: false, // As requested
                position: 'chat', // As requested
                // Add default values for other potential fields to be safe
                depth: 4, 
                enabled: true,
            });
        }

        // Save the changes and notify the user
        saveMetadataDebounced();
        new Popup(`<strong>AI Instruction Set!</strong><br>The AI has been instructed to avoid the following phrases:<br><br><em>${phrasesToBlock.join('<br>')}</em>`, POPUP_TYPE.SUCCESS).show();
    },
    ['count', 'range', 'clear'], // <-- THE FIX IS HERE
    '<span class="monospace">[count=5] [range="[2,3]"] [clear=true]</span> – Injects a prompt for the AI to avoid the top repetitive phrases. Use <code>clear=true</code> to remove the injection.',
    true,
    true
);
// ------------------- NEW COMMAND END -------------------
