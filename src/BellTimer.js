const _ = require('lodash');
const $ = require('jquery');
const async = require('async');

const Period = require('./Period');
const Schedule = require('./Schedule');
const Calendar = require('./Calendar');

class BellTimer {
    constructor(cookieManager, requestManager) {
        this.cookieManager = cookieManager;
        this.requestManager = requestManager;

        this.debug = function() {};
        this.devMode = false;
        this.startTime = 0;
        this.timeScale = 1;

        var devModeCookie = this.cookieManager.get('dev_mode');
        if (devModeCookie) {
            this.enableDevMode(devModeCookie.startDate, devModeCookie.scale);
        }
    }

    loadCustomCourses() {
        var courses = this.cookieManager.get('courses');

        // Make sure there is at least one section, otherwise it will infinite loop
        var foundSection = false;
        for (let id in courses) {
            var course = courses[id];
            if (course.sections.length) {
                foundSection = true;
                break;
            }
        }
        if (!foundSection)
            courses = {
                'none': {
                    name: 'No sections',
                    sections: [
                        ['Wednesday', [0, 0],
                            [24, 0]
                        ]
                    ]
                }
            };

        var week = {
            Sun: {
                name: 'Sunday'
            },
            Mon: {
                name: 'Monday'
            },
            Tue: {
                name: 'Tuesday'
            },
            Wed: {
                name: 'Wednesday'
            },
            Thu: {
                name: 'Thursday'
            },
            Fri: {
                name: 'Friday'
            },
            Sat: {
                name: 'Saturday'
            }
        };
        var special = {};
        var schedules = {};

        var periods = {};

        for (let id in courses) {
            var course = courses[id];
            var name = course.name;
            var sections = course.sections;

            for (let section of sections) {
                var [day, start, end] = section;
                if (!periods[day])
                    periods[day] = [];

                periods[day].push(new Period({
                    hour: start[0],
                    min: start[1]
                }, name));
                periods[day].push(new Period({
                    hour: end[0],
                    min: end[1]
                }, 'Free'));
            }
        }

        for (var day in week) {
            day = week[day].name;
            schedules[day] = new Schedule(day, day, periods[day] || []);
        }

        var calendar = new Calendar(week, special, schedules, this.cookieManager.get('periods'));

        this.setCorrection(0);
        this.calendar = calendar;
    }

    async reloadData() {
        var dataSource = this.cookieManager.get('source', 'lahs');
        if (dataSource == 'custom') {
            this.source = dataSource;
            return this.loadCustomCourses();
        }

        var [sources, version, correction, schedules, calendar] = await Promise.all([
            this.requestManager.get('/api/sources/names'),
            this.requestManager.get('/api/version'),
            this.requestManager.get(`/api/data/${dataSource}/correction`, '0'),
            this.requestManager.get(`/api/data/${dataSource}/schedules`),
            this.requestManager.get(`/api/data/${dataSource}/calendar`)
        ]);

        if (sources.indexOf(dataSource) < 0) {
            this.cookieManager.remove('source');
            return this.reloadData();
        }

        this.source = dataSource;

        if (this.version && this.version != version)
        // Give IndexedDB time to write (TODO: make more robust)
            setTimeout(() => $(window)[0].location.reload(), 1000);
        else
            this.version = version;

        this.setCorrection(parseInt(correction));

        var parseSchedules = require('./ScheduleParser');
        var parseCalendar = require('./CalendarParser');

        schedules = parseSchedules(schedules, this.cookieManager.get('periods'));
        calendar = parseCalendar(calendar, schedules);

        return this.calendar = calendar;
    }

    async initialize() {
        return Promise.all([
            this.reloadData(),
            this.initializeTimesync()
        ]);
    }

    async initializeTimesync() {
        if (typeof timesync == 'undefined') {
            this.ts = Date;
            console.warn('Timesync not found');
            return this.ts;
        }

        var ts = timesync.create({
            server: this.requestManager.host + '/timesync',
            interval: 4 * 60 * 1000
        });

        ts.on('change', offset =>
            this.debug('Timesync offset: ' + offset));

        this.ts = ts;

        return new Promise((resolve, reject) =>
            ts.on('sync', _.once(() => resolve(ts))));
    }

    setCorrection(correction) {
        this.correction = correction;
    }

    getCorrection() {
        return this.correction;
    }

    enableDevMode(startDate, scale) {
        console.warn('You are in Developer Mode, at ' + scale + 'x speed! Disable with `bellTimer.disableDevMode()`')

        this.devMode = true;
        this.startTime = new Date(startDate).getTime();
        this.devModeStartTime = Date.now();
        this.timeScale = scale;

        this.cookieManager.set('dev_mode', {
            enabled: this.devMode,
            startDate: startDate,
            scale: scale
        });
    }

    disableDevMode() {
        this.devMode = false;
        this.cookieManager.remove('dev_mode');
    }

    getDate() {
        if (this.devMode)
            return new Date((this.startTime + ((Date.now() - this.devModeStartTime) * this.timeScale) + this.correction));
        return new Date(this.ts.now() + this.correction);
    }

    getTimeRemainingNumber() {
        var date = this.getDate();
        return this.getNextPeriod().timestamp.getTime() - (date.getTime() / 1000) * 1000;
    }

    getTimeRemainingString() {
        var date = this.getDate();
        var displayTimeNumber = function(time) {
            var hours = Math.floor(time / 1000 / 60 / 60);
            var seconds = Math.floor(time / 1000 % 60).toString();
            if (seconds.length < 2)
                seconds = '0' + seconds;
            var minutes = Math.floor(time / 1000 / 60 % 60).toString();
            if (minutes.length < 2 && hours)
                minutes = '0' + minutes;
            return (hours < 1) ? minutes + ':' + seconds : hours + ':' + minutes + ':' + seconds;
        };
        return displayTimeNumber(this.getTimeRemainingNumber());
    }

    getProportionElapsed() {
        var date = this.getDate();

        var currentPeriodStart = this.getCurrentPeriod().timestamp.getTime();
        var nextPeriodStart = this.getNextPeriod().timestamp.getTime();

        var totalTime = nextPeriodStart - currentPeriodStart;
        var elapsedTime = date.getTime() - currentPeriodStart;

        return elapsedTime / totalTime;
    }

    getNextPeriod() {
        var date = this.getDate();
        var period = this.calendar.getSchedule(date).getNextPeriod(date);
        while (!period) {
            date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
            period = this.calendar.getSchedule(date).getFirstPeriod(date);
        }
        return period;
    }
    getPreviousPeriod() {
        var date = this.getDate();
        var period = this.calendar.getSchedule(date).getPreviousPeriod(date);
        while (!period) {
            date = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 0, 0, 0, 0);
            period = this.calendar.getSchedule(date).getLastPeriod(date);
        }
        return period;
    }

    getCurrentPeriod() {
        var date = this.getDate();
        var period = this.calendar.getSchedule(date).getCurrentPeriod(date);
        while (!period) {
            date = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 23, 59, 59, 999);
            period = this.calendar.getSchedule(date).getCurrentPeriod(date);
        }
        return period;
    }

    getCurrentPeriodNumber() {
        var date = this.getDate();
        return this.calendar.getSchedule(date).getCurrentPeriodIndex(date);
    }

    getCompletedPeriods() {
        var date = this.getDate();
        var completedPeriods = [];
        var schedule = this.getCurrentSchedule();
        for (var i = 0; i < this.getCurrentPeriodNumber(); i++)
            completedPeriods.push(schedule.getPeriodByIndex(i, date));
        return completedPeriods;
    }

    getFuturePeriods() {
        var date = this.getDate();
        var futurePeriods = [];
        var schedule = this.getCurrentSchedule();
        for (var i = this.getCurrentPeriodNumber() + 1; i < schedule.length; i++)
            futurePeriods.push(schedule.getPeriodByIndex(i, date));
        return futurePeriods;
    }

    getCurrentSchedule(date) {
        if (!date) date = this.getDate();
        return this.calendar.getSchedule(date);
    }
}

module.exports = BellTimer;