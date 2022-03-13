import {Action, assign, doneInvoke, MachineConfig, send,} from "xstate";
import {StatesConfig} from "xstate/lib/types";
import {raise} from "xstate/lib/actions";
import {done} from "xstate/es/actions";

type rasa_response_entity = {
    entity: string,
    start: number,
    end: number,
    value: string,
    extractor: string
}

function say(text: (context: SDSContext) => string): Action<SDSContext, any> {
    return send((_context: SDSContext) => ({type: "SPEAK", value: text(_context)}))
}

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

function getPromptStates(prompt: (context: SDSContext) => string): StatesConfig<SDSContext, any, SDSEvent> {
    return {
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
        },
        final: {
            type: 'final'
        }
    }
}

function binaryPromptMachine(prompt: (context: SDSContext) => string, targetTrue: string, targetFalse: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'prompt',
        states: {
            ...getPromptStates(prompt)
        },
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

function formFillingPromptMachine(prompt: (context: SDSContext) => string, condition: (context: SDSContext) => boolean, target: string): MachineConfig<SDSContext, any, SDSEvent> {
    return {
        initial: 'init',
        states: {
            ...getPromptStates(prompt),
            init: {
                always: [
                    {
                        target: 'final',
                        cond: condition
                    },
                    {
                        target: 'prompt'
                    }
                ]
            }
        },
        on: {
            RECOGNISED: '#parseUtterance',
            TIMEOUT: '.prompt'
        },
        onDone: target
    }
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
                TTS_READY: 'appointment',
                CLICK: 'appointment'
            }
        },
        appointment: {
            initial: 'fetchInformation',
            entry: assign<SDSContext>({title: '', time: '', day: ''}),
            states: {
                fetchInformation: {
                    initial: 'init',
                    states: {
                        hist: {
                            type: 'history'
                        },
                        init: {
                            entry: say(() => "Let's create a meeting"),
                            on: {
                                ENDSPEECH: 'getTitle'
                            }
                        },
                        getTitle: {
                            ...formFillingPromptMachine(
                                () => 'What is it about?',
                                (context) => context.title !== '',
                                'getDay')
                        },
                        getDay: {
                            ...formFillingPromptMachine(
                                () => 'On which day?',
                                (context) => context.day !== '',
                                'getTime')
                        },
                        getTime: {
                            ...formFillingPromptMachine(
                                () => 'At what time is it?',
                                (context) => context.time !== '',
                                'final')
                        },
                        final: {
                            type: 'final'
                        }
                    },
                    onDone: 'final'
                },
                parseUtterance: {
                    id: 'parseUtterance',
                    invoke: {
                        src: context => nluRequest(context.recResult[0].utterance),
                        onDone: [
                            {
                                cond: (_, event) => event.data['intent']['name'] === 'create_meeting',
                                actions: assign({
                                    title: (context, event) => {
                                        let entity: rasa_response_entity = event.data['entities'].find((element: rasa_response_entity) => element.entity === 'title')
                                        return entity && entity.value !== undefined ? entity.value : context.title
                                    },
                                    day: (context, event) => {
                                        let entity: rasa_response_entity = event.data['entities'].find((element: rasa_response_entity) => element.entity === 'day')
                                        return entity && entity.value !== undefined ? entity.value : context.day
                                    },
                                    time: (context, event) => {
                                        let entity: rasa_response_entity = event.data['entities'].find((element: rasa_response_entity) => element.entity === 'time')
                                        return entity && entity.value !== undefined ? entity.value : context.time
                                    },
                                }),
                                target: 'fetchInformation.hist'
                            }
                        ],
                        onError: 'fetchInformation.hist'
                    }
                },
                final: {
                    type: 'final'
                }
            },
            onDone: 'confirmation'
        },
        confirmation: {
            ...binaryPromptMachine(
                (context) =>
                    `Do you want me to create a meeting titled ${context.title} on ${context.day} `
                    + `${context.time !== undefined ? `at ${context.time}` : `for the whole day`}?`,
                'info',
                'appointment')
        },
        info: {
            entry: say(() => "Your meeting has been created!"),
            on: {ENDSPEECH: 'appointment'}
        }
    }
})

const rasaurl = 'https://speechstate-kuenkele-form.herokuapp.com/model/parse';
const nluRequest = (text: string) =>
    fetch(new Request(rasaurl, {
        method: 'POST',
        body: `{"text": "${text}"}`
    }))
        .then(data => data.json());
