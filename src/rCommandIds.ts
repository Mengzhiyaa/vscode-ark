export const RCommandIds = {
    startConsole: 'supervisor.startConsole',
    restartKernel: 'supervisor.restartKernel',
    selectRPath: 'supervisor.selectRPath',
    runCurrentStatement: 'supervisor.runCurrentStatement',
    insertAssignmentOperator: 'supervisor.insertAssignmentOperator',
    insertPipeOperator: 'supervisor.insertPipeOperator',
    helpShowHelpAtCursor: 'supervisor.help.showHelpAtCursor',
    helpLookupHelpTopic: 'supervisor.help.lookupHelpTopic',
    helpShowWelcome: 'supervisor.help.showWelcome',
    helpFind: 'supervisor.help.find',
} as const;
