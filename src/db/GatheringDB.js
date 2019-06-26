import { EventEmitter } from 'events'
import GatheringStore from './GatheringStore/Store'
import UsernameGenerator from 'username-generator'
import resizeImage from '../shared/resizeImage'
// import AwardEngine, { trackedEvents } from './AwardEngine'
import * as symmetricEncryption from '../shared/symmetricEncryption'
import * as asymmetricEncryption from '../shared/asymmetricEncryption'
import { ConnectionStatus, RecommendationStatus } from './GatheringStore/Index'

const slugify = (str, maxLength = 12) => str.toLowerCase().match(/([a-z0-9]+)/g).join('-').substring(0, maxLength)
const btoa = str => window ? window.btoa(str) : str

class GatheringDB extends EventEmitter {
  constructor (IPFS, OrbitDB, options = {}) {
    super()
    this.IPFS = IPFS
    this.OrbitDB = OrbitDB
    this.OrbitDB.addDatabaseType('gathering', GatheringStore)
    this._options = {
      locationBase: window ? window.location.origin : null,
      ...options
    }

    this.node = new this.IPFS({
      repo: '/orbitdb/gathering',
      start: true,
      preload: { enabled: false },
      EXPERIMENTAL: { pubsub: true },
      config: {
        Addresses: {
          Swarm: [
            '/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star'
            // process.env.REACT_APP_SIGNALSERVER
          ]
        }
      }
    })

    this.node.on('error', e => { throw e })
    this.node.on('ready', this._init.bind(this))
  }

  async _init () {
    this.peerInfo = await this.node.id()
    this.orbitdb = await this.OrbitDB.createInstance(this.node, {})
    this.memberId = this.orbitdb.identity.id

    this.defaultOptions = {
      accessController: { write: [this.memberId] }
    }
    this.publicOptions = {
      accessController: { write: ['*'] }
    }

    // Gatherings
    // ==================
    this.gatherings = await this.orbitdb.kvstore('gatherings', { replicate: false })
    await this.gatherings.load()

    this.appSettings = await this.orbitdb.kvstore('appSettings', { replicate: false })
    await this.appSettings.load()

    this.emit('ready', this)
    this.ready = true
  }

  /* #region  Gathering */
  getGatherings () {
    return Object.values(this.gatherings.all)
  }

  async activateGathering (key) {
    await this.appSettings.put('activeGathering', key)
    const { address, shareableKey, asymmetricKeyPair, ...rest } = this.gatherings.get(key)
    this.gathering = await this.orbitdb.open(address, { sync: true })
    await this.gathering.load()

    // Update our gatherings record if possible
    if (!rest.name && this.gathering.get('name')) {
      this.gatherings.put(key, {
        address,
        shareableKey,
        asymmetricKeyPair,
        ...rest,
        name: this.gathering.get('name'),
        end: this.gathering.get('end')
      })
    }

    // Get keys ready
    this.keys = {}

    // Load user profile
    this.my = { shareableKey, asymmetricKeyPair }
    if (this.gathering.me == null) {
      await this.gathering.putProfile({
        id: this.memberId,
        publicKey: asymmetricKeyPair.public,
        name: UsernameGenerator.generateUsername(' '),
        organization: '',
        avatar: null,
        privateInfo: null
      })
    }

    // Prep awards
    this.updateAwards()

    // Shareable address
    const encodedAddress = encodeURI(btoa(this.gathering.address.toString()))
    const encodedMemberId = encodeURI(btoa(this.memberId))
    this.shareableAddress = `${this._options.locationBase}/?g=${encodedAddress}&m=${encodedMemberId}`

    this.emit('gathering:activated', this.gathering.all)
  }

  async deactivateGathering () {
    await this.gathering.close()
    await this.appSettings.del('activeGathering')
    this.gathering = null
    this.my = {}
    this.keys = {}
    this.emit('gathering:deactivated', this.gathering)
  }

  async createGathering (gathering) {
    const key = slugify(gathering.name)
    const gatheringDb = await this.orbitdb.open(key, {
      ...this.publicOptions,
      type: 'gathering',
      create: true
    })
    await gatheringDb.load()
    gathering = {
      ...gathering,
      key
    }
    const keys = Object.keys(gathering)
    for (let i in keys) {
      const key = keys[i]
      await gatheringDb.put(key, gathering[key])
    }

    await this.gatherings.put(key, {
      key,
      name: gathering.name,
      end: gathering.end,
      address: gatheringDb.address.toString(),
      shareableKey: symmetricEncryption.generateKey(),
      asymmetricKeyPair: asymmetricEncryption.generateKeyPair()
    })
    await gatheringDb.close()

    return key
  }

  async joinGathering (address) {
    const existing = Object.values(this.gatherings.all).find(x => x.address === address)
    if (existing) return existing.key

    const key = address.split('/').slice(3).join('')
    await this.gatherings.put(key, {
      key,
      address,
      shareableKey: symmetricEncryption.generateKey(),
      asymmetricKeyPair: asymmetricEncryption.generateKeyPair()
    })

    const gatheringDb = await this.orbitdb.open(address, { sync: true })
    return new Promise(resolve => {
      gatheringDb.events.on('replicated', async () => {
        await gatheringDb.close()
        resolve(key)
      })
    })
  }
  /* #endregion */

  /* #region Awards */
  async updateAwards (force = false) {
    // TODO awards

    // if (!force && this.listenerCount('awards:updated') === 0) return

    // const nameMap = {}
    // Object.keys(this.members.all).forEach(id => { nameMap[id] = this.members.all[id].name })

    // this.awards = []
    // this.awards = this.awardEngine.processEvents(this.events, nameMap)
    // this.emit('awards:updated', this.awards)
  }
  /* #endregion */

  /* #region IPFS */
  async addImage (file, { width, height } = {}) {
    if (width && height) file = await resizeImage(file, width, height)
    const result = await this.node.add(file)
    const cid = result[0].hash
    return cid
  }

  async getImageFromCid (cid) {
    if (!this.imageCache) this.imageCache = {}
    try {
      if (!cid) throw new Error('Empty hash')
      const files = await this.node.get(cid)
      if (!files[0]) return null

      const base64 = files[0].content.toString('base64')
      return 'data:image/jpeg;base64,' + base64
    } catch (err) {
      return '/img/placeholder.jpg'
    }
  }
  /* #endregion */

  /* #region Requests */
  getRequests () {
    return Object.keys(this.gathering.connections)
      .map(id => ({ id, ...this.gathering.connections[id] }))
      .filter(x => x.status === ConnectionStatus.pending)
      .map(({ id }) => this.gathering.members[id])
  }

  getRequestsCount () {
    return Object.keys(this.gathering.connections)
      .map(id => ({ id, ...this.gathering.connections[id] }))
      .filter(x => x.status === ConnectionStatus.pending)
      .length
  }

  async acceptRequest (id) {
    await this.gathering.acceptConnection(id)
    await this.sendRequest(id) // Handles the case where connection has already been sent
  }

  declineRequest (id) {
    return this.gathering.declineConnection(id)
  }

  sendRequest (id) {
    return this.gathering.requestConnection(id, asymmetricEncryption.encrypt(this.my.asymmetricKeyPair.private, this.my.shareableKey, this.gathering.members[id].publicKey))
  }

  /* #endregion */

  /* #region Members */
  async queryMembers (queryFn) {
    return Object.values(this.gathering.members).filter(queryFn)
  }
  /* #endregion */

  /* #region Contacts */
  getKeyFor (id) {
    if (!this.keys[id]) {
      if (id === this.memberId) this.keys[id] = this.my.shareableKey
      else if (this.gathering.connections[id] != null) {
        this.keys[id] = asymmetricEncryption.decrypt(this.my.asymmetricKeyPair.private, this.gathering.connections[id].key, this.gathering.members[id].publicKey)
      }
    }
    return this.keys[id]
  }

  getContacts () {
    const connections = this.gathering.connections
    const contacts = Object.keys(connections)
      .filter(id => this.gathering.connections[id].status === ConnectionStatus.accepted)
      .map(id => this.getContact(id, true))

    return contacts
  }

  getContact (id, publicOnly = false) {
    const { privateInfo: encryptedPrivateInfo, ...publicInfo } = this.gathering.members[id]
    let key
    if (!publicOnly) key = this.getKeyFor(id)

    let decryptedPrivateInfo = {}
    if (key) {
      try {
        decryptedPrivateInfo = symmetricEncryption.decrypt(encryptedPrivateInfo, key)
      } catch (err) {}
    }

    return {
      id,
      ...publicInfo,
      ...decryptedPrivateInfo,
      stars: this.gathering.getStarsFor(id)
    }
  }

  getMe () {
    return this.getContact(this.memberId)
  }

  async updateMe ({ name, avatar, organization, ...unecryptedPrivateInfo }, affinities) {
    // Update affinityCounts
    const currentAffinities = this.gathering.myAffinities
    const affectedAffinities = [...new Set(currentAffinities.concat(affinities || []))]
    for (let i in affectedAffinities) {
      const affinityName = affectedAffinities[i]
      const added = affinities.includes(affinityName) && !currentAffinities.includes(affinityName)
      const removed = !affinities.includes(affinityName) && currentAffinities.includes(affinityName)

      if (added) await this.gathering.addToAffinity(affinityName)
      else if (removed) await this.gathering.removeFromAffinity(affinityName)
    }

    // Update member record
    const privateInfo = symmetricEncryption.encrypt(unecryptedPrivateInfo, this.my.shareableKey)
    await this.gathering.putProfile({
      name: name.trim(),
      organization,
      avatar,
      publicKey: this.my.asymmetricKeyPair.public,
      privateInfo
    })
  }

  deleteContact (id) {
    return this.gathering.deleteConnection(id)
  }
  /* #endregion Contacts */

  /* #region Affinities */
  getAffinities () {
    return Object.keys(this.gathering.affinities).map(name => {
      const affinity = this.gathering.affinities[name]
      return { ...affinity, name, memberCount: Object.keys(affinity.members).length }
    }).sort((a, b) => a.memberCount > b.memberCount)
  }

  getMyAffinities () {
    const affinities = this.gathering.myAffinities
    return affinities
  }

  addAffinity ({ name, color }) {
    return this.gathering.addAffinity(name, { color })
  }
  /* #endregion */

  /* #region Recommendations */
  getRecommendations () {
    return Object.keys(this.gathering.recommendations)
      .map(id => ({ id, ...this.gathering.recommendations[id] }))
      .filter(({ status }) => status === RecommendationStatus.pending)
      .map(({ id, by }) => ({
        id,
        ...this.gathering.members[id],
        by: Object.keys(by).map(byId => this.gathering.members[byId].name)
      }))
  }

  getRecommendationCount () {
    return Object.keys(this.gathering.recommendations)
      .map(id => ({ id, ...this.gathering.recommendations[id] }))
      .filter(({ status }) => status === RecommendationStatus.pending)
      .length
  }

  sendRecommendation (toId, forId) {
    return this.gathering.sendRecommendation(toId, forId)
  }

  deleteRecommendation (forId) {
    return this.gathering.declineRecommendation(forId)
  }
  /* #endregion */

  /* #region Stars */
  get starsAvailable () {
    return this.gathering.starsAvailable
  }
  addStar (id) {
    return this.gathering.sendStar(id)
  }
  /* #endregion */
}

export default GatheringDB