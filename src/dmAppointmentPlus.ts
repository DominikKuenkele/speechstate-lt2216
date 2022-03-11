import {Action, ActionTypes, assign, AssignAction, MachineConfig, PropertyAssigner, send, StatesConfig,} from "xstate";

function say(text: (context: SDSContext) => string): Action<SDSContext, any> {
    return send((_context: SDSContext) => ({type: "SPEAK", value: text(_context)}))
}

const menuGrammar: { [index: string]: { description: string, patterns: Array<RegExp> } } = {
    "meeting": {
        description: "create a meeting",
        patterns: [
            /Create a meeting./,
            /I would like to schedule a meeting./
        ]
    },
    "whois": {
        description: "request information about a person",
        patterns: [
            /Who is (.*)\?/,
            /Tell me something about (.*)\?/
        ]
    },
    "stop": {
        description: "stop me",
        patterns: [
            /Stop./,
            /Shut up./
        ]
    },
    "homeAssistant": {
        description: "ask me for home assistance",
        patterns: [
            /Can you help me with home assistance/,
            /Assist me in my home/
        ]
    },
    "options": {
        description: "",
        patterns: [
            /What can I do?/,
            /How can you help me?/
        ]
    }
};

const titleGrammar: { [index: string]: string } = {
    "Lecture.": "Dialogue systems lecture",
    "Lunch.": "Lunch at the canteen",
    "Training.": "Workout at the gym",
    "Cinema.": "Watching a movie at the cinema",
    "Shopping.": "Shopping in the city",
    "Swedish course.": "Learning swedish",
    "President.": "Talking to the president",
    "Garden": "Walk in the garden",
    "Sleeping": "Taking a nap"
};

const timeGrammar: RegExp = /(At )?(((1[0-2]|[1-9]):[0-5][0-9]|(1[0-2]|[1-9]))( [AP]M)?( o'clock)?\.?)/;

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
];

const binaryGrammar: { [index: string]: Array<string> } = {
    "Yes": ["Yes.", "Of course.", "Sure.", "Yeah.", "Yes please.", "Yep.", "OK.", "Yes, thank you."],
    "No": ["No.", "Nope.", "No no.", "Don't.", "Don't do it.", "No way.", "Not at all."]
};

const machineAnswers: { [index: string]: Array<string> } = {
    "CR": [
        "Sorry, could you please repeat that?",
        "I didn't catch that?",
        "What did you say?",
        "Come again?",
        "Sorry?",
        "Huh?"
    ]
};

const helpGrammar: RegExp[] = [
    /Help./
];

function getPrompts(prompt: ((context: SDSContext) => string)[]): StatesConfig<SDSContext, any, SDSEvent> {
    let state: StatesConfig<SDSContext, any, SDSEvent> = {
        hist: {
            type: 'history'
        }
    };

    for (let number in prompt) {
        state = {
            ...state,
            ['prompt' + number]: {
                entry: say(prompt[number]),
                on: {
                    ENDSPEECH: {
                        target: 'ask' + number,
                    }

                }
            },
            ['ask' + number]: {
                entry: send('LISTEN'),
                on: {
                    HIST: {
                        target: parseInt(number) + 1 < prompt.length ? 'prompt' + (parseInt(number) + 1) : '#root.dm.init'
                    }
                }
            }
        }
    }
    return state;
}


function abstractPromptMachine(prompt: ((context: SDSContext) => string)[]): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'prompt0',
        states: {
            ...getPrompts(prompt)
        }
    }
}

function verifyUtterance(utterance: string, category: string): boolean {
    switch (category) {
        case "title":
            return utterance in titleGrammar
        case "day":
            for (const day of dayGrammar) {
                if (utterance.includes(day)) {
                    return true;
                }
            }
            return false;
        case "time":
            return timeGrammar.test(utterance)
        default:
            return false;
    }
}

function getAssignActionFor(category: string): AssignAction<SDSContext, any> {
    let assigner: PropertyAssigner<SDSContext, any>;
    switch (category) {
        case "title":
            assigner = {title: (context) => titleGrammar[context.recResult[0].utterance]};
            break;
        case "day":
            assigner = {day: (context) => dayGrammar.find(day => context.recResult[0].utterance.includes(day))!};
            break;
        case "time":
            assigner = {
                time: (context) => {
                    let regexExec = timeGrammar.exec(context.recResult[0].utterance)!;
                    // use number/time and add AM/PM if existing
                    return regexExec[3] + (regexExec[6] !== undefined ? regexExec[6] : "")
                }
            }
            break;
        default:
            assigner = {}
    }
    return {
        type: ActionTypes.Assign,
        assignment: assigner
    }
}

function categoryPromptMachine(prompt: ((context: SDSContext) => string)[], category: string, target: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        ...abstractPromptMachine(prompt),
        on: {
            RECOGNISED: [
                {
                    target: target,
                    cond: (context) => verifyUtterance(context.recResult[0].utterance, category),
                    actions: {...getAssignActionFor(category)}
                }
            ],
            TIMEOUT: {
                target: '.hist',
                actions: send('HIST')
            }
        }
    };
}

function binaryPromptMachine(prompt: ((context: SDSContext) => string)[], targetTrue: string, targetFalse: string): MachineConfig<SDSContext, any, SDSEvent> {
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
                }
            ],
            TIMEOUT: {
                target: '.hist',
                actions: send('HIST')
            }
        }
    };
}

export const dmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
    initial: 'idle',
    on: {
        RECOGNISED: [
            {
                target: '.help',
                cond: context => helpGrammar.some((regex) => regex.test(context.recResult[0].utterance))
            },
            {
                target: '.nomatch'
            }
        ]
    },
    states: {
        idle: {
            on: {
                CLICK: 'init'
            }
        },
        init: {
            on: {
                TTS_READY: 'dialogue',
                CLICK: 'dialogue'
            }
        },
        help: {
            entry: say(() => 'I can help you to create meetings in your calendar'),
            on: {
                ENDSPEECH: 'dialogue.hist'
            }
        },
        nomatch: {
            entry: say(() => machineAnswers["CR"][Math.random() * machineAnswers["CR"].length | 0]),
            on: {
                ENDSPEECH: 'dialogue.hist'
            }
        },
        dialogue: {
            initial: 'getUsername',
            states: {
                hist: {
                    type: 'history',
                    history: 'deep'
                },
                getUsername: {
                    ...abstractPromptMachine([
                        () => 'Hi, who are you?',
                        () => 'What is your name?',
                        () => 'Hello?']),
                    on: {
                        RECOGNISED: [
                            {
                                target: 'welcome',
                                cond: context => context.recResult[0].utterance === "I don't want to be known."
                            },
                            {
                                target: 'welcome',
                                actions: assign({
                                    username: context => context.recResult[0].utterance
                                })
                            }
                        ],
                        TIMEOUT: {
                            target: '.hist',
                            actions: send('HIST')
                        }
                    }
                },
                welcome: {
                    ...abstractPromptMachine(
                        [
                            (context) => `How can I help you, ${context.username !== undefined ? context.username : 'Anonymous'}!`,
                            () => 'What can I do for you?',
                            (context) => `${context.username !== undefined ? context.username : 'Hello'}?`
                        ]
                    ),
                    on: {
                        RECOGNISED: [
                            {
                                target: 'createMeeting',
                                cond: context => menuGrammar["meeting"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance))
                            },
                            {
                                target: 'askForCelebrity',
                                cond: context => menuGrammar["whois"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance)),
                                actions: assign({
                                    celebrityName:
                                        context => {
                                            for (let pattern of menuGrammar["whois"]["patterns"]) {
                                                let regexExec = pattern.exec(context.recResult[0].utterance)!;
                                                if (regexExec !== null && regexExec[1] !== undefined) {
                                                    return regexExec[1]
                                                }
                                            }
                                            //will never happen, since cond verifies it already before
                                            return ""
                                        }
                                })
                            },
                            {
                                target: 'homeAssistant',
                                cond: context => menuGrammar["homeAssistant"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance))
                            },
                            {
                                target: 'menuHelp',
                                cond: context => menuGrammar["options"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance))
                            },
                            {
                                target: '#root.dm.init',
                                cond: context => menuGrammar["stop"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance))
                            }
                        ],
                        TIMEOUT: {
                            target: '.hist',
                            actions: send('HIST')
                        }
                    }
                },
                menuHelp: {
                    entry: say(() => {
                        let options = "You can "
                        Object.values(menuGrammar).forEach((value) =>
                            value["description"] !== "" ? options += value["description"] + " or " : "")
                        return options.substr(0, options.length - 4) + "."
                    }),
                    on: {
                        ENDSPEECH: "welcome.hist"
                    }
                },
                homeAssistant: {
                    initial: 'ask',
                    states: {
                        ask: {
                            ...abstractPromptMachine(
                                [
                                    () => 'How can I assist you?',
                                    () => 'How may I help you?',
                                    (context) => `${context.username}?`
                                ]),
                            on: {
                                RECOGNISED: 'invokeRasa',
                                TIMEOUT: {
                                    target: '.hist',
                                    actions: send('HIST')
                                }
                            }
                        },
                        invokeRasa: {
                            invoke: {
                                src: context => nluRequest(context.recResult[0].utterance),
                                onDone: [
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'vacuum',
                                        target: 'vacuum'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'move_to_trash',
                                        target: 'moveToTrash'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'give',
                                        target: 'give'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'turn_on_light',
                                        target: 'turnOnLight'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'turn_off_light',
                                        target: 'turnOffLight'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'cook',
                                        target: 'cook'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'ask_oven_warm',
                                        target: 'askOvenWarm'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'inform_oven_warm',
                                        target: 'informOvenWarm'
                                    },
                                    {
                                        cond: (_, event) => event.data['intent']['name'] === 'stop',
                                        target: 'stop'
                                    }
                                ],
                                onError: 'ask.hist'
                            }
                        },
                        vacuum: {
                            entry: say(() => 'I will clean the floor.'),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        moveToTrash: {
                            entry: say(() => 'I will throw it into the trash.'),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        give: {
                            entry: say(() => 'I will give it to them.'),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        turnOnLight: {
                            entry: say(() => "I'll turn on the light."),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        turnOffLight: {
                            entry: say(() => 'I will turn off the light.'),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        cook: {
                            entry: say(() => 'I will prepare the meal.'),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        askOvenWarm: {
                            entry: say(() => {
                                let responses = ['The oven is warm.', 'The oven is cold.'];
                                return responses[Math.random() * responses.length | 0]
                            }),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        informOvenWarm: {
                            entry: say(() => 'Ok, thanks.'),
                            on: {
                                ENDSPEECH: 'ask'
                            }
                        },
                        stop: {
                            entry: say(() => 'Alright.'),
                            on: {
                                ENDSPEECH: '#root.dm.dialogue.welcome'
                            }
                        }
                    }
                },
                askForCelebrity: {
                    invoke: {
                        src: context => kbRequest(context.celebrityName),
                        onDone: {
                            target: 'infoCelebrity',
                            // get only the first sentence of the Abstract
                            actions: assign({celebrityInfo: (context, event) => event.data["Abstract"].split(/\. [A-Z]/)[0]})
                        },
                        onError: {
                            target: 'meetingCelebrity',
                            actions: say(context => `Sorry, I didn't get any info about ${context.celebrityName}`)
                        }
                    }
                },
                infoCelebrity: {
                    entry: say(context =>
                        context.celebrityInfo !== ""
                            ? context.celebrityInfo
                            : `I couldn't find any info about ${context.celebrityName}!`),
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
                    ...binaryPromptMachine([
                        () => "Do you want to meet them?",
                        () => "Shall I create a meeting?",
                        (context) => `${context.username}?`
                    ], 'getDay', 'welcome')
                },
                createMeeting: {
                    entry: say(() => "Let's create a meeting."),
                    on: {
                        ENDSPEECH: 'getTitle'
                    }
                },
                getTitle: {
                    ...categoryPromptMachine([
                        () => "What is it about?",
                        () => "How should I call the meeting?",
                        () => "What is the purpose?"
                    ], "title", 'getDay'),
                },
                getDay: {
                    ...categoryPromptMachine([
                        () => "On which day is it?",
                        () => "Which day?",
                        (context) => `${context.username}?`
                    ], "day", 'wholeDay'),
                },
                wholeDay: {
                    ...binaryPromptMachine([
                        () => 'Will it take the whole day?',
                        () => 'For the whole day?',
                        () => 'Is it the whole day?'
                    ], 'confirmation', 'getTime')
                },
                getTime: {
                    ...categoryPromptMachine([
                        () => "What time is your meeting?",
                        () => "At which time?",
                        () => "When should is start?"
                    ], "time", 'confirmation'),
                },
                confirmation: {
                    ...binaryPromptMachine(
                        [(context) =>
                            `Do you want me to create a meeting titled ${context.title} on ${context.day} `
                            + `${context.time !== undefined ? `at ${context.time}` : `for the whole day`}?`],
                        'info',
                        'welcome')
                },
                info: {
                    entry: say(() => "Your meeting has been created!"),
                    on: {ENDSPEECH: 'welcome'}
                }
            }
        }
    }
})

const rasaurl = 'https://speechstate-lt2216-kuenkele.herokuapp.com/model/parse';
const nluRequest = (text: string) =>
    fetch(new Request(rasaurl, {
        method: 'POST',
        body: `{"text": "${text}"}`
    }))
        .then(data => data.json());

const kbRequest = (text: string) =>
    fetch(new Request(`https://cors.eu.org/https://api.duckduckgo.com/?q=${text}&format=json&skip_disambig=1`)).then(data => data.json())
