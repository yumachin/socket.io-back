"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, path, json, ...jsons) {
        parser.push('JSON.ARRAPPEND');
        parser.pushKey(key);
        parser.push(path, (0, helpers_1.transformRedisJsonArgument)(json));
        for (let i = 0; i < jsons.length; i++) {
            parser.push((0, helpers_1.transformRedisJsonArgument)(jsons[i]));
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=ARRAPPEND.js.map