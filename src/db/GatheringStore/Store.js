import Store from 'orbit-db-store'
import GatheringIndex, { ConnectionStatus, RecommendationStatus } from './Index'
import LocalStorageStore from '../LocalStorageStore'

export default class GatheringStore extends Store {
  constructor (ipfs, id, dbname, options = {}) {
    super(ipfs, id, dbname, {
      Index: GatheringIndex,
      ...options
    })
    this._type = 'gathering'
    this._tables = this._index._tables
    this._notes = new LocalStorageStore(dbname + '_notes')
    this.id = this.identity.id
  }

  /* #region debugging */
  /* as (id) {
    this.id = id
    return this
  }
  _addOperation (payload, ...args) {
    payload.by = this.id
    return super._addOperation(payload, ...args)
  } */
  /* #endregion */

  /* #region Gathering */
  get all () {
    return this._tables.gathering
  }
  get (key) {
    return this.all[key]
  }
  set (key, value) {
    return this.put(key, value)
  }
  put (key, value) {
    return this._addOperation({
      table: 'gathering',
      op: 'PUT',
      key,
      value
    })
  }
  del (key) {
    return this._addOperation({
      table: 'gathering',
      op: 'DEL',
      key
    })
  }
  get size () {
    return this._index._size
  }
  /* #endregion */

  /* #region Members */
  get members () {
    return this._tables.members
  }

  get me () {
    return this.members ? this.members[this.id] : null
  }

  putProfile (data) {
    return this._addOperation({
      table: 'members',
      op: 'PUT',
      value: data
    })
  }
  /* #endregion */

  /* #region Connections */
  get connections () {
    return this._tables.connections[this.id] || {}
  }

  get requests () {
    return Object.keys(this._tables.connections).filter(k => k !== this.id && this._tables.connections[k][this.id])
  }

  areConnected (fromId, toId) {
    return this._tables.connections[fromId] ? this._tables.connections[fromId][toId] != null : false
  }

  getConnection (toId) {
    return this.connections ? this.connections[toId] : null
  }

  getRequest (toId) {
    return this._tables.connections[toId] ? this._tables.connections[toId][this.id] : null
  }

  async requestConnection (toId, encryptedShareKey) {
    if (toId === this.id) throw new Error('You can\'t connect with yourself')
    if (this.getRequest(toId)) return // They're already connected
    if (this.getRecommendation(toId)) {
      await this.acceptRecommendation(toId)
    }

    return this._addOperation({
      table: 'connections',
      op: 'PUT',
      to: toId,
      value: { key: encryptedShareKey, status: 0 }
    })
  }

  acceptConnection (toId) {
    const connection = this.getConnection(toId)
    if (connection && connection.status !== ConnectionStatus.pending) return

    return this._addOperation({
      table: 'connections',
      op: 'ACCEPT',
      to: toId
    })
  }

  declineConnection (toId) {
    const connection = this.getConnection(toId)
    if (connection && connection.status !== ConnectionStatus.pending) return

    return this._addOperation({
      table: 'connections',
      op: 'DECLINE',
      to: toId
    })
  }

  deleteConnection (toId) {
    const connection = this.getConnection(toId)
    if (connection && connection.status === ConnectionStatus.deleted) return

    return this._addOperation({
      table: 'connections',
      op: 'DELETE',
      to: toId
    })
  }
  /* #endregion */

  /* #region Recommendations */
  get recommendations () {
    return this._tables.recommendations[this.id] || {}
  }

  getSentRecommendation (toId, forId) {
    return this._tables.recommendations[toId] ? this._tables.recommendations[toId][forId] : null
  }

  getRecommendation (forId) {
    return this.recommendations ? this.recommendations[forId] : null
  }

  sendRecommendation (toId, forId) {
    if (this.getSentRecommendation(toId, forId)) throw new Error('You\'ve already recommended that person')
    if (this.areConnected(toId, forId)) throw new Error('They are already connected')

    return this._addOperation({
      table: 'recommendations',
      op: 'PUT',
      to: toId,
      forId
    })
  }

  acceptRecommendation (forId) {
    const recommendation = this.getRecommendation(forId)
    if (recommendation && recommendation.status !== RecommendationStatus.pending) return

    return this._addOperation({
      table: 'recommendations',
      op: 'ACCEPT',
      forId
    })
  }

  declineRecommendation (forId) {
    const recommendation = this.getRecommendation(forId)
    if (recommendation && recommendation.status !== RecommendationStatus.pending) return

    return this._addOperation({
      table: 'recommendations',
      op: 'DECLINE',
      forId
    })
  }
  /* #endregion */

  /* #region Stars */
  get stars () {
    return this._tables.stars[this.id]
  }

  get starsAvailable () {
    return this._tables.starsAvailable[this.id]
  }

  getStarsFor (id) {
    return (this._tables.stars[id] ? this._tables.stars[id][this.id] : null) || 0
  }

  async sendStar (toId) {
    if (this.getStarsAvailable() <= 0) throw new Error('You have no more stars to give')

    await this._addOperation({
      table: 'starsAvailable',
      op: 'DEC'
    })

    return this._addOperation({
      table: 'stars',
      op: 'INC',
      to: toId
    })
  }
  /* #endregion */

  /* #region Score */
  get score () {
    return this._tables.score
  }
  /* #endregion */

  /* #region Affinities */
  get affinities () {
    return this._tables.affinities
  }

  get myAffinities () {
    return this.getAffinitiesFor(this.id)
  }

  getAffinitiesFor (id) {
    return Object.keys(this.affinities).filter(name => this.affinities[name].members[id])
  }

  hasAffinity (name) {
    return this.affinities[name] && this.affinities[name].members[this.id]
  }

  addAffinity (name, data) {
    if (this.affinities[name]) return

    return this._addOperation({
      table: 'affinities',
      op: 'PUT',
      name,
      data
    })
  }

  addToAffinity (name) {
    if (!this.affinities[name] || this.hasAffinity(name)) return

    return this._addOperation({
      table: 'affinities',
      op: 'ADD_MEMBER',
      name
    })
  }

  removeFromAffinity (name) {
    if (!this.affinities[name] || !this.hasAffinity(name)) return

    return this._addOperation({
      table: 'affinities',
      op: 'DEL_MEMBER',
      name
    })
  }
  /* #endregion */

  /* #region Notes */
  get notes () {
    return this._notes.all
  }

  getNotesFor (id) {
    return this._notes.get(id) || ''
  }

  setNotesFor (id, notes) {
    this._notes.put(id, notes)
  }
  /* #endregion */

  saveSnapshot () {
    console.log('save snapshot')
    window.localStorage[this.dbname] = JSON.stringify(this._index._tables)
  }
  loadFromSnapshot () {
    console.log('load snapshot')
    if (window.localStorage[this.dbname]) this._tables = this._index._tables = JSON.parse(window.localStorage[this.dbname])
    else throw new Error('No snapshot')
  }
}
