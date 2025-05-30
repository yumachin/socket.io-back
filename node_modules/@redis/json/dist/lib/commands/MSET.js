"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, items) {
        parser.push('JSON.MSET');
        for (let i = 0; i < items.length; i++) {
            parser.pushKey(items[i].key);
            parser.push(items[i].path, (0, helpers_1.transformRedisJsonArgument)(items[i].value));
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=MSET.js.map