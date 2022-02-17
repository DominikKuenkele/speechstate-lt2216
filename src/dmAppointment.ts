import {Action, ActionTypes, assign, AssignAction, MachineConfig, PropertyAssigner, send,} from "xstate";

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
    "options": {
        description: "",
        patterns: [
            /What can I do?/,
            /How can you help me?/
        ]
    }
}

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
}

const timeGrammar: RegExp = /(At )?(((1[0-2]|[1-9]):[0-5][0-9]|(1[0-2]|[1-9]))( [AP]M)?( o'clock)?\.?)/

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
    "Yes": ["Yes.", "Of course.", "Sure.", "Yeah.", "Yes please.", "Yep.", "OK.", "Yes, thank you."],
    "No": ["No.", "Nope.", "No no.", "Don't.", "Don't do it.", "No way.", "Not at all."]
}

const machineAnswers: { [index: string]: Array<string> } = {
    "CR": [
        "Sorry, could you please repeat that?",
        "I didn't catch that?",
        "What did you say?",
        "Come again?",
        "Sorry?",
        "Huh?"
    ]
}

function abstractPromptMachine(prompt: (context: SDSContext) => string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'prompt',
        states: {
            prompt: {
                entry: say(context => prompt(context)),
                on: {ENDSPEECH: 'ask'}
            },
            ask: {
                entry: send('LISTEN'),
            },
            nomatch: {
                entry: say(() => machineAnswers["CR"][Math.random() * machineAnswers["CR"].length | 0]),
                on: {ENDSPEECH: 'ask'}
            }
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

function categoryPromptMachine(prompt: (context: SDSContext) => string, category: string, target: string): MachineConfig<SDSContext, any, SDSEvent> {
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
            ],
            TIMEOUT: '.prompt'
        }
    };
}

function binaryPromptMachine(prompt: (context: SDSContext) => string, targetTrue: string, targetFalse: string): MachineConfig<SDSContext, any, SDSEvent> {
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
            TIMEOUT: '.prompt'
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
                TTS_READY: 'getUsername',
                CLICK: 'getUsername'
            }
        },
        getUsername: {
            ...abstractPromptMachine(() => 'Hi, who are you?'),
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
                TIMEOUT: '.prompt'
            }
        },
        welcome: {
            ...abstractPromptMachine(
                (context) => `How can I help you, ${context.username !== undefined ? context.username : 'Anonymous'}!`
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
                        target: 'menuHelp',
                        cond: context => menuGrammar["options"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance))
                    },
                    {
                        target: 'init',
                        cond: context => menuGrammar["stop"]["patterns"].some((regex) => regex.test(context.recResult[0].utterance))
                    },
                    {
                        target: '.nomatch'
                    }
                ],
                TIMEOUT: '.prompt'
            }
        },
        menuHelp: {
            entry: say(() => {
                let options = "You can "
                Object.values(menuGrammar).forEach((value) =>
                    value["description"] != "" ? options += value["description"] + " or " : "")
                return options.substr(0, options.length - 4) + "."
            }),
            on: {
                ENDSPEECH: "welcome.ask"
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
            ...binaryPromptMachine(() => "Do you want to meet them?", 'getDay', 'welcome')
        },
        createMeeting: {
            entry: say(() => "Let's create a meeting."),
            on: {
                ENDSPEECH: 'getTitle'
            }
        },
        getTitle: {
            ...categoryPromptMachine(() => "What is it about?", "title", 'getDay'),
        },
        getDay: {
            ...categoryPromptMachine(() => "On which day is it?", "day", 'wholeDay'),
        },
        wholeDay: {
            ...binaryPromptMachine(() => 'Will it take the whole day?', 'confirmation', 'getTime')
        },
        getTime: {
            ...categoryPromptMachine(() => "What time is your meeting?", "time", 'confirmation'),
        },
        confirmation: {
            ...binaryPromptMachine(
                (context) =>
                    `Do you want me to create a meeting titled ${context.title} on ${context.day} `
                    + `${context.time !== undefined ? `at ${context.time}` : `for the whole day`}?`,
                'info',
                'welcome')
        },
        info: {
            entry: say(() => "Your meeting has been created!"),
            on: {ENDSPEECH: 'welcome'}
        }
    }
})


const kbRequest = (text: string) =>
    fetch(new Request(`https://cors.eu.org/https://api.duckduckgo.com/?q=${text}&format=json&skip_disambig=1`)).then(data => data.json())
