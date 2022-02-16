import {Action, ActionTypes, assign, AssignAction, MachineConfig, PropertyAssigner, send} from "xstate";

function say(text: string): Action<SDSContext, SDSEvent> {
    return send((_context: SDSContext) => ({type: "SPEAK", value: text}))
}

const grammar: { [index: string]: { title?: string, day?: string, time?: string } } = {
    "Lecture.": {title: "Dialogue systems lecture"},
    "Lunch.": {title: "Lunch at the canteen"},

    "At 10": {time: "10:00"},
}

const dayGrammar: string[] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Today",
    "Tomorrow"
]

const binaryGrammar: { [index: string]: Array<string> } = {
    "Yes": ["Yes.", "Of course."],
    "No": ["No."]
}

function abstractPromptMachine(prompt: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'prompt',
        on: {
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
    }
}

function verifyUtterance(utterance: string, category: string): boolean {
    switch (category) {
        case "title":
            return "title" in (grammar[utterance] || {})
        case "day":
            for (const day of dayGrammar) {
                if (utterance.includes(day)) {
                    return true;
                }
            }
            return false;
        case "time":
            return "time" in (grammar[utterance] || {})
        default:
            return false;
    }
}

function getAssignActionFor(category: string): AssignAction<SDSContext, any> {
    let assigner: PropertyAssigner<SDSContext, any>;
    switch (category) {
        case "title":
            assigner = {title: (context) => grammar[context.recResult[0].utterance].title!};
            break;
        case "day":
            assigner = {day: (context) => dayGrammar.find(day => context.recResult[0].utterance.includes(day))!};
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
function categoryPromptMachine(prompt: string, category: string, target: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        ...abstractPromptMachine(prompt),
        on: {
            RECOGNISED: [
                {
                    target: target,
                    cond: (context) => verifyUtterance(context.recResult[0].utterance, category),
                    actions: {...getAssignActionFor(category)}
                },
                {
                    target: '.nomatch'
                }
            ]
        }
    };
}

function binaryPromptMachine(prompt: string, targetTrue: string, targetFalse: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        ...abstractPromptMachine(prompt),
        on: {
            RECOGNISED: [
                {
                    target: targetTrue,
                    cond: (context) => binaryGrammar["Yes"].includes(context.recResult[0].utterance)
                },
                {
                    target: targetFalse,
                    cond: (context) => binaryGrammar["No"].includes(context.recResult[0].utterance)
                },
                {
                    target: '.nomatch'
                }
            ],
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
                TTS_READY: 'hello',
                CLICK: 'hello'
            }
        },
        hello: {
            entry: send((context) => ({
                type: 'SPEAK',
                value: `Hi ${context.username !== undefined ? context.username : 'Anonymous'}!`
            })),
            on: {
                ENDSPEECH: 'welcome'
            }
        },
        welcome: {
            ...abstractPromptMachine(""),
            initial: 'ask',
            on: {
                RECOGNISED: [
                    {
                        target: 'createMeeting',
                        cond: context => "Create a meeting." == (context.recResult[0].utterance)
                    },
                    {
                        target: 'askForCelebrity',
                        cond: context => /Who is .*/.test(context.recResult[0].utterance),
                        actions: assign({
                            celebrityName:
                                context => context.recResult[0].utterance.replace("Who is ", "").replace("?", "")
                        })
                    },
                    {
                        target: '.nomatch'
                    }
                ]
            }
        },
        askForCelebrity: {
            invoke: {
                src: context => kbRequest(context.celebrityName),
                onDone: {
                    target: 'infoCelebrity',
                    actions: assign({celebrityInfo: (context, event) => event.data["Abstract"].split(/\. [A-Z]/)[0]})
                },
                onError: {
                    target: 'meetingCelebrity',
                    actions: send(context => ({
                        type: "SPEAK",
                        value: `Sorry, I didn't get any info about ${context.celebrityName}`
                    }))
                }
            }
        },
        infoCelebrity: {
            entry: send(context => ({
                type: "SPEAK",
                value: context.celebrityInfo !== "" ? context.celebrityInfo : `I couldn't find any info about ${context.celebrityName}!`
            })),
            on: {
                ENDSPEECH: {
                    target: 'meetingCelebrity',
                    actions: assign({
                        title: context => `Meeting with ${context.celebrityName}`
                    })
                }
            }
        },
        meetingCelebrity: {
            ...binaryPromptMachine("Do you want to meet them?", 'getDay', 'init')
        },
        createMeeting: {
            entry: say("Let's create a meeting."),
            on: {
                ENDSPEECH: 'getTitle'
            }
        },
        getTitle: {
            ...categoryPromptMachine("What is it about?", "title", 'getDay'),
        },
        getDay: {
            ...categoryPromptMachine("On which day is it?", "day", 'wholeDay'),
        },
        wholeDay: {
            ...binaryPromptMachine('Will it take the whole day?', 'confirmation', 'getTime')
        },
        getTime: {
            ...categoryPromptMachine("What time is your meeting?", "time", 'confirmation'),
        },
        confirmation: {
            entry: send((context) => ({
                type: "SPEAK",
                value: `Do you want me to create a meeting titled ${context.title} on ${context.day} `
                    + `${context.time !== undefined ? `at ${context.time}` : `for the whole day`}?`
            })),
            on: {ENDSPEECH: '.ask'},
            ...binaryPromptMachine("", 'info', 'getTitle')
        },
        info: {
            entry: say("Your meeting has been created!"),
            on: {ENDSPEECH: 'init'}
        }
    }
})


const kbRequest = (text: string) =>
    fetch(new Request(`https://cors.eu.org/https://api.duckduckgo.com/?q=${text}&format=json&skip_disambig=1`)).then(data => data.json())
