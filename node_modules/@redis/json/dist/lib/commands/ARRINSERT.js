"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("./helpers");
exports.default = {
    IS_READ_ONLY: false,
    parseCommand(parser, key, path, index, json, ...jsons) {
        parser.push('JSON.ARRINSERT');
        parser.pushKey(key);
        parser.push(path, index.toString(), (0, helpers_1.transformRedisJsonArgument)(json));
        for (let i = 0; i < jsons.length; i++) {
            parser.push((0, helpers_1.transformRedisJsonArgument)(jsons[i]));
        }
    },
    transformReply: undefined
};
//# sourceMappingURL=ARRINSERT.js.map