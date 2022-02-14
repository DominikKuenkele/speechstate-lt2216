import {Action, ActionTypes, AssignAction, MachineConfig, PropertyAssigner, send} from "xstate";


function say(text: string): Action<SDSContext, SDSEvent> {
    return send((_context: SDSContext) => ({type: "SPEAK", value: text}))
}

const grammar: { [index: string]: { title?: string, day?: string, time?: string } } = {
    "Lecture.": {title: "Dialogue systems lecture"},
    "Lunch.": {title: "Lunch at the canteen"},
    "On Friday.": {day: "Friday"},
    "At 10": {time: "10:00"},
}

const binaryGrammar: { [index: string]: Array<string> } = {
    "Yes": ["Yes.", "Of course."],
    "No": ["No"]
}

function getAssignActionFor(category: string): AssignAction<SDSContext, any> {
    let assigner: PropertyAssigner<SDSContext, any>;
    switch (category) {
        case "title":
            assigner = {title: (context) => grammar[context.recResult[0].utterance].title!};
            break;
        case "day":
            assigner = {day: (context) => grammar[context.recResult[0].utterance].day!};
            break;
        case "time":
            assigner = {time: (context) => grammar[context.recResult[0].utterance].time!}
            break;
        default:
            assigner = {}
    }
    return {
        type: ActionTypes.Assign,
        assignment: assigner
    }
}

function promptMachine(prompt: string, category: string, target: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'prompt',
        on: {
            RECOGNISED: [
                {
                    target: target,
                    cond: (context) => category in (grammar[context.recResult[0].utterance] || {}),
                    actions: {
                        ...getAssignActionFor(category)
                    }
                },
                {
                    target: '.nomatch'
                }
            ],
            TIMEOUT: '.prompt'
        },
        states: {
            prompt: {
                entry: say(prompt),
                on: {ENDSPEECH: 'ask'}
            },
            ask: {
                entry: send('LISTEN'),
            },
            nomatch: {
                entry: say("Sorry, could you please repeat that?"),
                on: {ENDSPEECH: 'ask'}
            }
        }
    };
}

function binaryPromptMachine(prompt: string, target: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'prompt',
        on: {
            RECOGNISED: [
                {
                    target: target,
                    cond: (context) => binaryGrammar["Yes"].includes(context.recResult[0].utterance)
                },
                {
                    target: 'getTitle',
                    cond: (context) => binaryGrammar["No"].includes(context.recResult[0].utterance)
                },
                {
                    target: '.nomatch'
                }
            ],
            TIMEOUT: '.nomatch'
        },
        states: {
            prompt: {
                entry: say(prompt),
                on: {ENDSPEECH: 'ask'}
            },
            ask: {
                entry: send('LISTEN'),
            },
            nomatch: {
                entry: say("Sorry, could you please repeat that?"),
                on: {ENDSPEECH: 'ask'}
            }
        }
    };
}

export const dmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
    initial: 'idle',
    states: {
        idle: {
            on: {
                CLICK: 'init'
            }
        },
        init: {
            on: {
                TTS_READY: 'welcome',
                CLICK: 'welcome'
            }
        },
        welcome: {
            entry: say("Let's create a meeting."),
            on: {
                ENDSPEECH: 'getTitle'
            }
        },
        getTitle: {
            ...promptMachine("What is it about?", "title", 'getDay'),
        },
        getDay: {
            ...promptMachine("On which day is it?", "day", 'getTime'),
        },
        getTime: {
            ...promptMachine("What time is your meeting?", "time", 'confirmation'),
        },
        confirmation: {
            entry: send((context) => ({
                type: "SPEAK",
                value: `Do you want me to create a meeting titled ${context.title} on ${context.day} at ${context.time}?`
            })),
            on: {ENDSPEECH: '.ask'},
            ...binaryPromptMachine("", 'info')
        },
        info: {
            entry: say("Your meeting has been created!"),
            on: {ENDSPEECH: 'init'}
        }
    }
})

const kbRequest = (text: string) =>
    fetch(new Request(`https://cors.eu.org/https://api.duckduckgo.com/?q=${text}&format=json&skip_disambig=1`)).then(data => data.json())
