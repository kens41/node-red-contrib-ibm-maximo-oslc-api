"use strict";

var connect = require('./connect.js');
var request = require('request');
var mustache = require('mustache');

var message;
var resourceUrl;
var qs = {};

module.exports = function(RED) {
    function MaximoDelete(config) {
        RED.nodes.createNode(this, config);

		this.on('input', function(msg) {
			message = msg;
			resourceUrl = config.resourceUrl;

			var localContext = this.context().flow.global;
			var connectionName = RED.nodes.getNode(config.maximoConnection).name.replace(' ', '');
			var sessionInfo = localContext.get(connectionName);
			var lean = sessionInfo.lean;
			var tenantCode = sessionInfo.tenantCode;

			if(lean === true)
				qs.lean = 1;

			if(tenantCode) {
				if(tenantCode.indexOf("{{") != -1)
					tenantCode = mustache.render(tenantCode, message);

				qs._tenantcode = tenantCode;
			}
			
			if(resourceUrl.indexOf("{{") != -1) {
				resourceUrl = mustache.render(resourceUrl, message);
			}

			// Check if we are already connected to Maximo
			if(sessionInfo.session === null) { // Connect
				connect(this, message, sessionInfo, localContext, connectionName, deletefnc);
			} else // Reuse the existing connection
				deletefnc(this, message, sessionInfo);
        });
    }

    RED.nodes.registerType('delete', MaximoDelete);
}

function deletefnc(node, message, sessionInfo) {
	node.status({fill:"green",shape:"ring",text:"sending"});
	var url = resourceUrl;

	var opts = {
		method: 'DELETE',
		url: url,
		qs: qs,
		headers: {
			Cookie: sessionInfo.session,
		}
	};

	request(opts, function (error, response, responseBody) {
		message.maximo = {
			request: opts,
			response: {}
		};

		var jsonBody;
		if(responseBody != null && responseBody.length > 0)
			jsonBody = JSON.parse(responseBody);
		else
			jsonBody = {}

		if(error != null || jsonBody.Error != null) {
			if(jsonBody.Error.reasonCode === "BMXAA0021E") {
				var localContext = node.context().flow.global;
				var connectionName;
				for(let element of localContext.keys()) {
					if(element !== "get" && element !== "set" && element !== "keys") {
						if(localContext.get(element).session === sessionInfo.session) {
							connectionName = element;
							break;
						}
					}
				}
				connect(node, message, sessionInfo, localContext, connectionName, deletefnc);
				return;
			} else {
				node.status({fill:"red",shape:"dot",text:"error on delete"});
				message.maximo.response.error = JSON.stringify(error);

				node.send(message);
				return;
			}
		}

		message.maximo.response.payload = 'No content';
		message.maximo.response.headers = response.headers;
		message.maximo.response.statusCode = response.statusCode;
		
		if(response.statusCode !== 204)
			node.status({fill:"red",shape:"dot",text:"not deleted"});
		else
			node.status({fill:"green",shape:"dot",text:"deleted"});

		node.send(message);
	});
}