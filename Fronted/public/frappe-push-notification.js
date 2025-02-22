import { initializeApp } from "firebase/app"
import {
	getMessaging,
	getToken,
	isSupported,
	deleteToken,
	onMessage as onFCMMessage,
} from "firebase/messaging"

class FrappePushNotification {
	static get relayServerBaseURL() {
		return window.frappe?.boot.push_relay_server_url
	}

	 * Web Config
	 * FCM web config to initialize firebase app
	 *
	 * @typedef {object} webConfigType
	 * @property {string} projectId
	 * @property {string} appId
	 * @property {string} apiKey
	 * @property {string} authDomain
	 * @property {string} messagingSenderId
	 */

	 * Constructor
	 *
	 * @param {string} projectName
	 */
	constructor(projectName) {
		this.projectName = projectName
		this.webConfig = null
		this.vapidPublicKey = ""
		this.token = null

		this.initialized = false
		this.messaging = null
		this.serviceWorkerRegistration = null

		this.onMessageHandler = null
	}

	 * Initialize notification service client
	 *
	 * @param {ServiceWorkerRegistration} serviceWorkerRegistration - Service worker registration object
	 * @returns {Promise<void>}
	 */
	async initialize(serviceWorkerRegistration) {
		if (this.initialized) {
			return
		}
		this.serviceWorkerRegistration = serviceWorkerRegistration
		const config = await this.fetchWebConfig()
		this.messaging = getMessaging(initializeApp(config))
		this.onMessage(this.onMessageHandler)
		this.initialized = true
	}

	 * Append config to service worker URL
	 *
	 * @param {string} url - Service worker URL
	 * @param {string} parameter_name - Parameter name to add config
	 * @returns {Promise<string>} - Service worker URL with config
	 */
	async appendConfigToServiceWorkerURL(url, parameter_name = "config") {
		let config = await this.fetchWebConfig()
		const encode_config = encodeURIComponent(JSON.stringify(config))
		return `${url}?${parameter_name}=${encode_config}`
	}

	 * Fetch web config of the project
	 *
	 * @returns {Promise<webConfigType>}
	 */
	async fetchWebConfig() {
		if (this.webConfig !== null && this.webConfig !== undefined) {
			return this.webConfig
		}
		try {
			let url = `${FrappePushNotification.relayServerBaseURL}/api/method/notification_relay.api.get_config?project_name=${this.projectName}`
			let response = await fetch(url)
			let response_json = await response.json()
			this.webConfig = response_json.config
			return this.webConfig
		} catch (e) {
			throw new Error(
				"Push Notification Relay is not configured properly on your site."
			)
		}
	}

	 * Fetch VAPID public key
	 *
	 * @returns {Promise<string>}
	 */
	async fetchVapidPublicKey() {
		if (this.vapidPublicKey !== "") {
			return this.vapidPublicKey
		}
		try {
			let url = `${FrappePushNotification.relayServerBaseURL}/api/method/notification_relay.api.get_config?project_name=${this.projectName}`
			let response = await fetch(url)
			let response_json = await response.json()
			this.vapidPublicKey = response_json.vapid_public_key
			return this.vapidPublicKey
		} catch (e) {
			throw new Error(
				"Push Notification Relay is not configured properly on your site."
			)
		}
	}

	 * Register on message handler
	 *
	 * @param {function(
	 *  {
	 *    data:{
	 *       title: string,
	 *       body: string,
	 *       click_action: string|null,
	 *    }
	 *  }
	 * )} callback - Callback function to handle message
	 */
	onMessage(callback) {
		if (callback == null) return
		this.onMessageHandler = callback
		if (this.messaging == null) return
		onFCMMessage(this.messaging, this.onMessageHandler)
	}

	 * Check if notification is enabled
	 *
	 * @returns {boolean}
	 */
	isNotificationEnabled() {
		return localStorage.getItem(`firebase_token_${this.projectName}`) !== null
	}

	 * Enable notification
	 * This will return notification permission status and token
	 *
	 * @returns {Promise<{permission_granted: boolean, token: string}>}
	 */
	async enableNotification() {
		if (!(await isSupported())) {
			throw new Error("Push notifications are not supported on your device")
		}
		if (this.token != null) {
			return {
				permission_granted: true,
				token: this.token,
			}
		}
		const permission = await Notification.requestPermission()
		if (permission !== "granted") {
			return {
				permission_granted: false,
				token: "",
			}
		}
		let oldToken = localStorage.getItem(`firebase_token_${this.projectName}`)
		const vapidKey = await this.fetchVapidPublicKey()
		let newToken = await getToken(this.messaging, {
			vapidKey: vapidKey,
			serviceWorkerRegistration: this.serviceWorkerRegistration,
		})
		if (oldToken !== newToken) {
			if (oldToken) {
				await this.unregisterTokenHandler(oldToken)
			}
			let isSubscriptionSuccessful = await this.registerTokenHandler(newToken)
			if (isSubscriptionSuccessful === false) {
				throw new Error("Failed to subscribe to push notification")
			}
			localStorage.setItem(`firebase_token_${this.projectName}`, newToken)
		}
		this.token = newToken
		return {
			permission_granted: true,
			token: newToken,
		}
	}

	 * Disable notification
	 * This will delete token from firebase and unsubscribe from push notification
	 *
	 * @returns {Promise<void>}
	 */
	async disableNotification() {
		if (this.token == null) {
			this.token = localStorage.getItem(`firebase_token_${this.projectName}`)
			if (this.token == null || this.token === "") {
				return
			}
		}
		try {
			await deleteToken(this.messaging)
		} catch (e) {
			console.error("Failed to delete token from firebase")
			console.error(e)
		}
		try {
			await this.unregisterTokenHandler(this.token)
		} catch {
			console.error("Failed to unsubscribe from push notification")
			console.error(e)
		}
		localStorage.removeItem(`firebase_token_${this.projectName}`)
		this.token = null
	}

	 * Register Token Handler
	 *
	 * @param {string} token - FCM token returned by {@link enableNotification} method
	 * @returns {promise<boolean>}
	 */
	async registerTokenHandler(token) {
		try {
			let response = await fetch(
				"/api/method/frappe.push_notification.subscribe?fcm_token=" +
					token +
					"&project_name=" +
					this.projectName,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
				}
			)
			return response.status === 200
		} catch (e) {
			console.error(e)
			return false
		}
	}

	 * Unregister Token Handler
	 *
	 * @param {string} token - FCM token returned by `enableNotification` method
	 * @returns {promise<boolean>}
	 */
	async unregisterTokenHandler(token) {
		try {
			let response = await fetch(
				"/api/method/frappe.push_notification.unsubscribe?fcm_token=" +
					token +
					"&project_name=" +
					this.projectName,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
				}
			)
			return response.status === 200
		} catch (e) {
			console.error(e)
			return false
		}
	}
}

export default FrappePushNotification
